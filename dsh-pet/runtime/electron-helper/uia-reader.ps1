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

# ---- Win32：拿真正的前台窗口 ----
if (-not ('W32Fg' -as [type])) {
  Add-Type -Namespace '' -Name 'W32Fg' -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int lpdwProcessId);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetAncestor(System.IntPtr hwnd, uint gaFlags);
'@
}

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
  if ($ExcludePid -gt 0 -and $fgPid -eq $ExcludePid) {
    return @{ ok = $false; reason = 'self-foreground'; pid = $fgPid }
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
