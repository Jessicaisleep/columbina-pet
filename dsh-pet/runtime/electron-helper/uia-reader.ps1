# UIA 读屏常驻进程：stdin 收一行命令，stdout 回一行 JSON
# 命令：dump             -> 读前台窗口文本快照
#       ping             -> {"ok":true}
#       quit             -> 退出
#
# 设计要点：
#   - 常驻（避免每次 ~540ms 的 spawn 开销）
#   - **用 GetForegroundWindow 定位前台窗口，而不是 UIA 的 FocusedElement**
#     为什么：FocusedElement 在桌宠场景下经常返回桌面（#32769）或宠物自己的窗口，
#     实测抓到「窗口标题为空、类名 #32769、内容却是上个应用的残留文本」。
#     GetForegroundWindow 拿到的才是用户正在用的那个窗口。
#   - 排除桌宠自己的进程（否则它会读到自己的气泡文字，变成自我循环）
#   - 只读 Text/Edit/Document 三类控件的 Name，限数量与字符上限，防大页面卡死
#   - 输出单行 JSON，UTF-8，不夹带其他打印
#
# ## 「回落到上一个非自我窗口」（2026-10-27 新增）
# 桌宠的**对话输入框就在它自己的窗口里**（main.js 的 focusable:true 就是为它留的）。
# 于是用户打字提问的那一刻，前台窗口必然 = 桌宠自己 → ExcludePid 命中 → 读不到屏幕 →
# 「问它屏幕上有什么，它说看不到」。
#
# 修法：每次成功读到**非自我**窗口时把句柄缓存起来；当前台是自己时，回落到那份缓存。
# 三条边界：
#   1. 缓存窗口必须仍然存在（IsWindow）且**仍然不是自己**，否则照旧失败；
#   2. 缓存超过 $CACHE_TTL_SEC 秒就作废——否则半小时前看过的私人页面会被反复读进 prompt；
#   3. 回落时在 JSON 里带 `stale=$true`，上层据此知道「这不是当前窗口」，措辞可以保守些。
param(
  [int]$ExcludePid = 0
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$MAX_TEXT = 60          # 最多取多少条文本片段
$MAX_CHARS = 2200       # 汇总文本字符上限
$BUDGET_MS = 900        # 单次抓取的墙钟预算
$CACHE_TTL_SEC = 90     # 「上一个非自我窗口」的保鲜期：过期就不回落（防把旧私人页面反复读进来）

# ---- Win32：拿真正的前台窗口 ----
if (-not ('W32Fg' -as [type])) {
  Add-Type -Namespace '' -Name 'W32Fg' -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int lpdwProcessId);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetAncestor(System.IntPtr hwnd, uint gaFlags);
[System.Runtime.InteropServices.DllImport("user32.dll")]
[return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
public static extern bool IsWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")]
[return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
public static extern bool IsWindowVisible(System.IntPtr hWnd);
'@
}

# 「上一个**非自我**前台窗口」缓存（脚本作用域状态，随常驻进程存活）
# ⚠️ 必须写 $script: 前缀：PowerShell 在函数内 `$X = ...` 会创建**局部**变量，
# 脚本作用域那份不会变。第一版漏了这个前缀，导致缓存永远是 Zero、回落永远不触发
# （实测：前台切到被排除的窗口后仍返回 self-foreground）。
$script:LAST_FG = [IntPtr]::Zero
$script:LAST_AT = [DateTime]::MinValue

function Out-Json($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 6
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Invoke-Dump {
  $sw = [Diagnostics.Stopwatch]::StartNew()

  # 1) 取前台窗口句柄
  $hwnd = [W32Fg]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { return @{ ok = $false; reason = 'no-foreground' } }

  # 2) 拿它所属进程，排除自己（桌宠进程会把自己的气泡读进来）
  $fgPid = 0
  [void][W32Fg]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
  $stale = $false
  if ($ExcludePid -gt 0 -and $fgPid -eq $ExcludePid) {
    # 前台就是桌宠自己（用户在对话输入框打字 / 打开了右键菜单）。
    # 回落到「上一个非自我窗口」，前提是它还在、还可见、还没过期、且仍然不是自己。
    # 全部用 $script: 前缀读——函数作用域看不见脚本作用域的同名变量本身没问题，
    # 但**写**的时候不加前缀就是新建局部变量（见上面 LAST_FG 处的坑说明）。
    $useLast = $false
    if ($script:LAST_FG -ne [IntPtr]::Zero `
        -and ([DateTime]::Now - $script:LAST_AT).TotalSeconds -le $CACHE_TTL_SEC `
        -and [W32Fg]::IsWindow($script:LAST_FG) `
        -and [W32Fg]::IsWindowVisible($script:LAST_FG)) {
      $lastPid = 0
      [void][W32Fg]::GetWindowThreadProcessId($script:LAST_FG, [ref]$lastPid)
      # 缓存的那只窗口也不能是自己（理论上不会，但缓存污染时兜住）
      if ($lastPid -ne $ExcludePid) { $useLast = $true }
    }
    if (-not $useLast) { return @{ ok = $false; reason = 'self-foreground'; pid = $fgPid } }
    $hwnd = $script:LAST_FG
    $stale = $true
  } else {
    # 前台是别人的窗口 → 更新缓存（只有这里会写，保证缓存里永远是非自我窗口）
    $script:LAST_FG = $hwnd
    $script:LAST_AT = [DateTime]::Now
  }

  # 3) 句柄 -> UIA 元素。GA_ROOT(2) 保证拿到顶层窗而不是子控件
  $root = [W32Fg]::GetAncestor($hwnd, 2)
  if ($root -eq [IntPtr]::Zero) { $root = $hwnd }
  $win = $null
  try { $win = [System.Windows.Automation.AutomationElement]::FromHandle($root) } catch { }
  if (-not $win) {
    try { $win = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd) } catch { }
  }
  if (-not $win) { return @{ ok = $false; reason = 'uia-from-handle-failed' } }

  $name = ''
  $cls = ''
  $wpid = 0
  try { $name = [string]$win.Current.Name } catch {}
  try { $cls = [string]$win.Current.ClassName } catch {}
  try { $wpid = [int]$win.Current.ProcessId } catch {}

  $types = @(
    [System.Windows.Automation.ControlType]::Text,
    [System.Windows.Automation.ControlType]::Edit,
    [System.Windows.Automation.ControlType]::Document
  )
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $parts = New-Object 'System.Collections.Generic.List[string]'
  $total = 0
  $truncated = $false

  foreach ($ct in $types) {
    if ($sw.ElapsedMilliseconds -gt $BUDGET_MS) { $truncated = $true; break }
    try {
      $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ct)
      $found = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    } catch { continue }

    for ($i = 0; $i -lt $found.Count; $i++) {
      if ($sw.ElapsedMilliseconds -gt $BUDGET_MS) { $truncated = $true; break }
      if ($total -ge $MAX_TEXT) { $truncated = $true; break }
      $t = ''
      try { $t = [string]$found[$i].Current.Name } catch { continue }
      if ([string]::IsNullOrWhiteSpace($t)) { continue }
      $t = $t.Trim()
      if ($t.Length -gt 300) { $t = $t.Substring(0, 300) }
      if (-not $seen.Add($t)) { continue }
      $total++
      $parts.Add($t)
    }
  }

  $sb = New-Object System.Text.StringBuilder
  foreach ($p in $parts) {
    if ($sb.Length + $p.Length + 1 -gt $MAX_CHARS) { $truncated = $true; break }
    if ($sb.Length -gt 0) { [void]$sb.Append(' | ') }
    [void]$sb.Append($p)
  }

  return @{
    ok        = $true
    title     = $name
    cls       = $cls
    pid       = $wpid
    text      = $sb.ToString()
    pieces    = $total
    truncated = $truncated
    ms        = $sw.ElapsedMilliseconds
    stale     = $stale
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if ($line -eq '' ) { continue }
  if ($line -eq 'quit') { break }
  if ($line -eq 'ping') { Out-Json @{ ok = $true }; continue }
  if ($line -eq 'dump') {
    try { Out-Json (Invoke-Dump) }
    catch { Out-Json @{ ok = $false; reason = 'error'; message = $_.Exception.Message } }
    continue
  }
  Out-Json @{ ok = $false; reason = 'unknown-command' }
}
