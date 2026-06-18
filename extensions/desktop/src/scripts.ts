/**
 * Static PowerShell scripts for Windows desktop automation.
 * Dynamic values are read from the OPENCLAW_DESKTOP_ARGS env var (JSON) so the
 * scripts never need string interpolation. Each script prints exactly one
 * compact JSON line on success.
 */

const PREAMBLE = `
$ErrorActionPreference = 'Stop'
$A = if ($env:OPENCLAW_DESKTOP_ARGS) { $env:OPENCLAW_DESKTOP_ARGS | ConvertFrom-Json } else { $null }
$DeskSrc = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DeskNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);

  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public InputUnion U; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

  public static void KeyPress(byte vk) {
    keybd_event(vk, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(15);
    keybd_event(vk, 0, 2, UIntPtr.Zero);
    System.Threading.Thread.Sleep(15);
  }

  static void SendCharPair(char c) {
    INPUT[] pair = new INPUT[2];
    pair[0].type = 1; pair[0].U.ki.wScan = c; pair[0].U.ki.dwFlags = 0x0004;
    pair[1].type = 1; pair[1].U.ki.wScan = c; pair[1].U.ki.dwFlags = 0x0006;
    SendInput(2, pair, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(8);
  }

  // One char per SendInput call: batching many KEYEVENTF_UNICODE events triggers
  // a VK_PACKET race where slow apps translate backlogged events with the latest
  // packet state, collapsing the tail of the text into the final character.
  //
  // Guarded: aborts when the foreground window changes mid-type (a popup stole
  // focus, keystrokes would land in the wrong app) or when the physical cursor
  // moves (the human grabbed the mouse — yield immediately).
  public static string TypeText(string text) {
    IntPtr startFg = GetForegroundWindow();
    POINT startPos; GetCursorPos(out startPos);
    int typed = 0;
    foreach (char c in text) {
      if (typed % 10 == 9) {
        if (GetForegroundWindow() != startFg) { return typed + "|focus-changed"; }
        POINT now; GetCursorPos(out now);
        if (Math.Abs(now.X - startPos.X) > 40 || Math.Abs(now.Y - startPos.Y) > 40) { return typed + "|user-mouse-moved"; }
      }
      if (c == '\\r') { typed++; continue; }
      if (c == '\\n') { KeyPress(0x0D); typed++; continue; }
      if (c == '\\t') { KeyPress(0x09); typed++; continue; }
      SendCharPair(c);
      typed++;
    }
    return typed + "|ok";
  }

  public static void DragMouse(int x1, int y1, int x2, int y2, int steps, int stepDelayMs) {
    SetCursorPos(x1, y1);
    System.Threading.Thread.Sleep(120);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(150);
    for (int i = 1; i <= steps; i++) {
      int nx = x1 + (int)((x2 - x1) * (double)i / steps);
      int ny = y1 + (int)((y2 - y1) * (double)i / steps);
      SetCursorPos(nx, ny);
      // Relative zero-move fires a real WM_MOUSEMOVE so drop targets track the drag.
      mouse_event(0x0001, 0, 0, 0, UIntPtr.Zero);
      System.Threading.Thread.Sleep(stepDelayMs);
    }
    System.Threading.Thread.Sleep(120);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
  }

  public static bool FocusWindow(IntPtr hWnd) {
    if (IsIconic(hWnd)) { ShowWindowAsync(hWnd, 9); System.Threading.Thread.Sleep(250); }
    uint pidIgnored;
    uint targetThread = GetWindowThreadProcessId(hWnd, out pidIgnored);
    uint thisThread = GetCurrentThreadId();
    IntPtr fg = GetForegroundWindow();
    uint fgThread = 0;
    if (fg != IntPtr.Zero) { fgThread = GetWindowThreadProcessId(fg, out pidIgnored); }
    bool attachedTarget = false;
    bool attachedFg = false;
    if (targetThread != thisThread) { attachedTarget = AttachThreadInput(thisThread, targetThread, true); }
    if (fgThread != 0 && fgThread != thisThread && fgThread != targetThread) { attachedFg = AttachThreadInput(thisThread, fgThread, true); }
    BringWindowToTop(hWnd);
    bool ok = SetForegroundWindow(hWnd);
    if (attachedFg) { AttachThreadInput(thisThread, fgThread, false); }
    if (attachedTarget) { AttachThreadInput(thisThread, targetThread, false); }
    System.Threading.Thread.Sleep(250);
    return ok;
  }
}
'@
# Compile-once cache: Add-Type -TypeDefinition launches the C# compiler on every
# call, and this host machine is sensitive to process/CPU churn. Cache the
# compiled assembly on disk (hash-named, so source changes self-invalidate) and
# load it on subsequent calls instead of recompiling.
$deskLoaded = $false
try {
  $md5 = [System.Security.Cryptography.MD5]::Create()
  $hashHex = ([System.BitConverter]::ToString($md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($DeskSrc))) -replace '-', '').Substring(0, 12)
  $deskDir = Join-Path $env:LOCALAPPDATA 'OpenClaw\\desknative'
  $deskDll = Join-Path $deskDir ('DeskNative-' + $hashHex + '.dll')
  if (Test-Path $deskDll) {
    Add-Type -Path $deskDll
    $deskLoaded = $true
  } else {
    if (-not (Test-Path $deskDir)) { [void](New-Item -ItemType Directory -Force -Path $deskDir) }
    Add-Type -TypeDefinition $DeskSrc -OutputAssembly $deskDll
    Add-Type -Path $deskDll
    $deskLoaded = $true
  }
} catch { }
if (-not $deskLoaded) { Add-Type -TypeDefinition $DeskSrc }
[void][DeskNative]::SetProcessDPIAware()

function Get-ForegroundInfo {
  $h = [DeskNative]::GetForegroundWindow()
  $sb = New-Object System.Text.StringBuilder 512
  [void][DeskNative]::GetWindowText($h, $sb, 512)
  $procId = [uint32]0
  [void][DeskNative]::GetWindowThreadProcessId($h, [ref]$procId)
  return @{ title = $sb.ToString(); processId = [int]$procId; hwnd = [int64]$h }
}

function Find-WindowHandle([string]$query) {
  if (-not $query) { return [DeskNative]::GetForegroundWindow() }
  $q = $query.ToLowerInvariant()
  $cands = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle.ToLowerInvariant().Contains($q) })
  if ($cands.Count -eq 0) { return [IntPtr]::Zero }
  # Several windows can share a title substring (e.g. two Notepads). Prefer the
  # one already in the foreground, then an exact title match, then any window
  # that is not minimized, then give up and take the first.
  $fg = [DeskNative]::GetForegroundWindow()
  foreach ($p in $cands) { if ($p.MainWindowHandle -eq $fg) { return $p.MainWindowHandle } }
  foreach ($p in $cands) { if ($p.MainWindowTitle.ToLowerInvariant() -eq $q) { return $p.MainWindowHandle } }
  foreach ($p in $cands) { if (-not [DeskNative]::IsIconic($p.MainWindowHandle)) { return $p.MainWindowHandle } }
  return $cands[0].MainWindowHandle
}

function Test-ProcessElevated([int]$procId) {
  # Best-effort: accessing .Handle of a higher-integrity process throws for a
  # non-elevated caller. Returns $null when undetermined.
  try {
    $p = Get-Process -Id $procId -ErrorAction Stop
    $null = $p.Handle
    return $false
  } catch [System.ComponentModel.Win32Exception] {
    return $true
  } catch {
    return $null
  }
}
`;

// Shared UIA helpers (assemblies + element walking) for scripts that read the tree.
const UIA_HELPERS = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase

function Get-ElementInfo($el, [int]$maxValueChars) {
  $cur = $el.Current
  $role = ''
  try { $role = $cur.ControlType.ProgrammaticName -replace '^ControlType\\.', '' } catch { }
  $name = ''
  try { $name = [string]$cur.Name } catch { }
  $value = $null
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $value = [string]$vp.Current.Value
  } catch { }
  if ($null -eq $value) {
    try {
      $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      $value = $tp.DocumentRange.GetText($maxValueChars)
    } catch { }
  }
  if ($value -and $value.Length -gt $maxValueChars) { $value = $value.Substring(0, $maxValueChars) }
  $enabled = $true
  try { $enabled = $cur.IsEnabled } catch { }
  $rect = $cur.BoundingRectangle
  $hasRect = -not ([double]::IsNaN($rect.X) -or [double]::IsInfinity($rect.X) -or $rect.Width -le 0)
  return @{
    role = $role
    name = $name
    value = $value
    enabled = $enabled
    x = $(if ($hasRect) { [int]($rect.X + $rect.Width / 2) } else { 0 })
    y = $(if ($hasRect) { [int]($rect.Y + $rect.Height / 2) } else { 0 })
    w = $(if ($hasRect) { [int]$rect.Width } else { 0 })
    h = $(if ($hasRect) { [int]$rect.Height } else { 0 })
    hasRect = $hasRect
  }
}

function Get-ElementAtPoint([int]$x, [int]$y) {
  try {
    $pt = New-Object System.Windows.Point -ArgumentList ([double]$x), ([double]$y)
    return [System.Windows.Automation.AutomationElement]::FromPoint($pt)
  } catch {
    return $null
  }
}

function Search-Elements($root, [string]$nameQuery, [string]$roleQuery, [int]$maxResults, [int]$maxDepth) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $nq = if ($nameQuery) { $nameQuery.ToLowerInvariant() } else { '' }
  $rq = if ($roleQuery) { $roleQuery.ToLowerInvariant() } else { '' }
  $results = New-Object System.Collections.ArrayList
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@($root, 0))
  $visited = 0
  while ($queue.Count -gt 0) {
    if ($results.Count -ge $maxResults) { break }
    $pair = $queue.Dequeue()
    $el = $pair[0]
    $depth = [int]$pair[1]
    $visited++
    if ($visited -gt 4000) { break }
    $offscreen = $false
    try { $offscreen = $el.Current.IsOffscreen } catch { }
    if (-not ($offscreen -and $depth -gt 0)) {
      $info = Get-ElementInfo $el 120
      $matchesName = $true
      if ($nq) {
        $hay = (($info.name + ' ' + [string]$info.value)).ToLowerInvariant()
        $matchesName = $hay.Contains($nq)
      }
      $matchesRole = $true
      if ($rq) { $matchesRole = ([string]$info.role).ToLowerInvariant().Contains($rq) }
      if ($depth -gt 0 -and $info.hasRect -and $matchesName -and $matchesRole) {
        $info.Remove('hasRect')
        [void]$results.Add($info)
      }
    }
    if ($depth -lt $maxDepth) {
      try {
        $child = $walker.GetFirstChild($el)
        while ($null -ne $child) {
          $queue.Enqueue(@($child, ($depth + 1)))
          $child = $walker.GetNextSibling($child)
        }
      } catch { }
    }
  }
  return $results
}
`;

export const STATUS_SCRIPT =
  PREAMBLE +
  `
Add-Type -AssemblyName System.Windows.Forms
$fg = Get-ForegroundInfo
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$secureDesktopHint = $false
if ($fg.hwnd -eq 0) { $secureDesktopHint = $true }
@{ ok = $true; platform = 'windows'; screen = @{ width = $b.Width; height = $b.Height }; foreground = $fg; secureDesktopHint = $secureDesktopHint } | ConvertTo-Json -Compress -Depth 5
`;

export const APPS_SCRIPT =
  PREAMBLE +
  `
$fg = [DeskNative]::GetForegroundWindow()
$list = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {
  @{ processId = $_.Id; process = $_.ProcessName; title = $_.MainWindowTitle; foreground = ($_.MainWindowHandle -eq $fg) }
})
@{ ok = $true; windows = $list } | ConvertTo-Json -Compress -Depth 5
`;

export const FOCUS_SCRIPT =
  PREAMBLE +
  `
$h = Find-WindowHandle ([string]$A.title)
if ($h -eq [IntPtr]::Zero) {
  @{ ok = $false; error = 'window not found: ' + [string]$A.title } | ConvertTo-Json -Compress
  exit 0
}
$focused = [DeskNative]::FocusWindow($h)
Start-Sleep -Milliseconds 250
$fg = Get-ForegroundInfo
$result = @{ ok = $true; focused = $focused; foreground = $fg }
if (-not $focused -or ($fg.hwnd -ne [int64]$h)) {
  $procId = [uint32]0
  [void][DeskNative]::GetWindowThreadProcessId($h, [ref]$procId)
  $elevated = Test-ProcessElevated ([int]$procId)
  if ($elevated -eq $true) {
    $result.hint = 'target process is elevated (admin) — Windows blocks input injection across integrity levels (UIPI); run the gateway elevated or interact with a non-elevated window'
  }
}
$result | ConvertTo-Json -Compress -Depth 5
`;

export const LAUNCH_SCRIPT =
  PREAMBLE +
  `
if ($A.appArgs) {
  Start-Process -FilePath ([string]$A.app) -ArgumentList ([string]$A.appArgs)
} else {
  Start-Process -FilePath ([string]$A.app)
}
Start-Sleep -Milliseconds 1500
$fg = Get-ForegroundInfo
@{ ok = $true; launched = [string]$A.app; foreground = $fg } | ConvertTo-Json -Compress -Depth 5
`;

export const SNAPSHOT_SCRIPT =
  PREAMBLE +
  `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$maxElements = if ($A.maxElements) { [int]$A.maxElements } else { 300 }
$maxDepth = if ($A.maxDepth) { [int]$A.maxDepth } else { 15 }

$h = Find-WindowHandle ([string]$A.title)
if ($h -eq [IntPtr]::Zero) {
  @{ ok = $false; error = 'window not found: ' + [string]$A.title } | ConvertTo-Json -Compress
  exit 0
}

# When a title is given, bring that window to the foreground before reading it
# so the refs the model acts on belong to the window that will receive input.
if ($A.title) {
  [void][DeskNative]::FocusWindow($h)
}

$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

$sb = New-Object System.Text.StringBuilder 512
[void][DeskNative]::GetWindowText($h, $sb, 512)
$procId = [uint32]0
[void][DeskNative]::GetWindowThreadProcessId($h, [ref]$procId)

$interactive = @('Button','Edit','MenuItem','ListItem','CheckBox','RadioButton','ComboBox','Hyperlink','TabItem','Document','SplitButton','Slider','Spinner','TreeItem','DataItem','HeaderItem','Thumb','Text')

$elements = New-Object System.Collections.ArrayList
$queue = New-Object System.Collections.Queue
$queue.Enqueue(@($root, 0))
$visited = 0
$truncated = $false

while ($queue.Count -gt 0) {
  if ($elements.Count -ge $maxElements) { $truncated = $true; break }
  $pair = $queue.Dequeue()
  $el = $pair[0]
  $depth = [int]$pair[1]
  $visited++
  if ($visited -gt 3000) { $truncated = $true; break }

  $cur = $el.Current
  $offscreen = $false
  try { $offscreen = $cur.IsOffscreen } catch { }
  if ($offscreen -and $depth -gt 0) { continue }

  $role = ''
  try { $role = $cur.ControlType.ProgrammaticName -replace '^ControlType\\.', '' } catch { }
  $name = ''
  try { $name = [string]$cur.Name } catch { }
  if ($name.Length -gt 80) { $name = $name.Substring(0, 80) }

  $value = $null
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $value = [string]$vp.Current.Value
  } catch { }
  if ($null -eq $value -and ($role -eq 'Document' -or $role -eq 'Edit')) {
    try {
      $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      $value = $tp.DocumentRange.GetText(400)
    } catch { }
  }
  if ($value -and $value.Length -gt 200) { $value = $value.Substring(0, 200) }

  $rect = $cur.BoundingRectangle
  $hasRect = -not ([double]::IsNaN($rect.X) -or [double]::IsInfinity($rect.X) -or $rect.Width -le 0)

  $include = $depth -gt 0 -and $hasRect -and (($name -ne '') -or ($interactive -contains $role) -or ($null -ne $value))
  if ($include) {
    $enabled = $true
    try { $enabled = $cur.IsEnabled } catch { }
    [void]$elements.Add(@{
      role = $role
      name = $name
      value = $value
      x = [int]($rect.X + $rect.Width / 2)
      y = [int]($rect.Y + $rect.Height / 2)
      w = [int]$rect.Width
      h = [int]$rect.Height
      enabled = $enabled
    })
  }

  if ($depth -lt $maxDepth) {
    try {
      $child = $walker.GetFirstChild($el)
      while ($null -ne $child) {
        $queue.Enqueue(@($child, ($depth + 1)))
        $child = $walker.GetNextSibling($child)
      }
    } catch { }
  }
}

$payload = @{
  ok = $true
  window = @{ title = $sb.ToString(); processId = [int]$procId }
  elements = @($elements)
  truncated = $truncated
}
if ($elements.Count -eq 0) {
  $elevated = Test-ProcessElevated ([int]$procId)
  if ($elevated -eq $true) {
    $payload.hint = 'window belongs to an elevated (admin) process — UI Automation cannot read it from a non-elevated gateway; interact with a non-elevated window or run the gateway elevated'
  } elseif ([DeskNative]::IsIconic($h)) {
    $payload.hint = 'window is minimized and could not be restored — try action=window windowOp=restore first'
  }
}
$payload | ConvertTo-Json -Compress -Depth 6
`;

export const CLICK_SCRIPT =
  PREAMBLE +
  `
[void][DeskNative]::SetCursorPos([int]$A.x, [int]$A.y)
Start-Sleep -Milliseconds 60
$btn = [string]$A.button
$down = 0x0002
$up = 0x0004
if ($btn -eq 'right') { $down = 0x0008; $up = 0x0010 }
if ($btn -eq 'middle') { $down = 0x0020; $up = 0x0040 }
[DeskNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
[DeskNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
if ($A.double) {
  Start-Sleep -Milliseconds 80
  [DeskNative]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
  [DeskNative]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
}
@{ ok = $true; clicked = @{ x = [int]$A.x; y = [int]$A.y; button = $(if ($btn) { $btn } else { 'left' }) } } | ConvertTo-Json -Compress -Depth 4
`;

export const TYPE_SCRIPT =
  PREAMBLE +
  `
$r = [DeskNative]::TypeText([string]$A.text)
$parts = $r.Split('|')
$typed = [int]$parts[0]
$status = $parts[1]
if ($status -eq 'ok') {
  @{ ok = $true; typedChars = $typed } | ConvertTo-Json -Compress
} else {
  $why = if ($status -eq 'focus-changed') { 'foreground window changed mid-type (popup or app stole focus) — keystrokes stopped to avoid typing into the wrong window; re-focus and retry' } else { 'the human moved the mouse — typing stopped to yield control; retry when the user is idle' }
  @{ ok = $false; typedChars = $typed; aborted = $status; error = $why } | ConvertTo-Json -Compress
}
`;

export const KEY_SCRIPT =
  PREAMBLE +
  `
$mods = @()
if ($A.modifiers) { $mods = @($A.modifiers | ForEach-Object { [byte]$_ }) }
$vk = [byte]$A.key
foreach ($m in $mods) { [DeskNative]::keybd_event($m, 0, 0, [UIntPtr]::Zero) }
Start-Sleep -Milliseconds 30
[DeskNative]::keybd_event($vk, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[DeskNative]::keybd_event($vk, 0, 2, [UIntPtr]::Zero)
[array]::Reverse($mods)
foreach ($m in $mods) { [DeskNative]::keybd_event($m, 0, 2, [UIntPtr]::Zero) }
@{ ok = $true; pressed = [string]$A.label } | ConvertTo-Json -Compress
`;

export const SCROLL_SCRIPT =
  PREAMBLE +
  `
if ($null -ne $A.x -and $null -ne $A.y) {
  [void][DeskNative]::SetCursorPos([int]$A.x, [int]$A.y)
  Start-Sleep -Milliseconds 40
}
$delta = [int]$A.delta * 120
[DeskNative]::mouse_event(0x0800, 0, 0, $delta, [UIntPtr]::Zero)
@{ ok = $true; scrolled = [int]$A.delta } | ConvertTo-Json -Compress
`;

export const MOVE_SCRIPT =
  PREAMBLE +
  `
[void][DeskNative]::SetCursorPos([int]$A.x, [int]$A.y)
@{ ok = $true; moved = @{ x = [int]$A.x; y = [int]$A.y } } | ConvertTo-Json -Compress -Depth 4
`;

export const DRAG_SCRIPT =
  PREAMBLE +
  `
[DeskNative]::DragMouse([int]$A.x, [int]$A.y, [int]$A.toX, [int]$A.toY, 16, 20)
@{ ok = $true; dragged = @{ from = @{ x = [int]$A.x; y = [int]$A.y }; to = @{ x = [int]$A.toX; y = [int]$A.toY } } } | ConvertTo-Json -Compress -Depth 5
`;

export const CLIPBOARD_SCRIPT =
  PREAMBLE +
  `
Add-Type -AssemblyName System.Windows.Forms
$op = [string]$A.op
if ($op -eq 'set') {
  $text = [string]$A.text
  if ($text) {
    [System.Windows.Forms.Clipboard]::SetText($text)
  } else {
    [System.Windows.Forms.Clipboard]::Clear()
  }
  @{ ok = $true; set = $true; chars = $text.Length } | ConvertTo-Json -Compress
} else {
  $text = ''
  try { $text = [System.Windows.Forms.Clipboard]::GetText() } catch { }
  $truncated = $false
  if ($text.Length -gt 8000) { $text = $text.Substring(0, 8000); $truncated = $true }
  @{ ok = $true; text = $text; truncated = $truncated } | ConvertTo-Json -Compress
}
`;

export const PASTE_SCRIPT =
  PREAMBLE +
  `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText([string]$A.text)
Start-Sleep -Milliseconds 150
[DeskNative]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[DeskNative]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 30
[DeskNative]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)
[DeskNative]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150
@{ ok = $true; pastedChars = ([string]$A.text).Length; note = 'clipboard now contains the pasted text' } | ConvertTo-Json -Compress
`;

export const READ_SCRIPT =
  PREAMBLE +
  UIA_HELPERS +
  `
$maxChars = if ($A.maxChars) { [int]$A.maxChars } else { 2000 }
$el = Get-ElementAtPoint ([int]$A.x) ([int]$A.y)
if ($null -eq $el) {
  @{ ok = $false; error = 'no UI element at that point' } | ConvertTo-Json -Compress
  exit 0
}
$info = Get-ElementInfo $el $maxChars
$info.Remove('hasRect')
@{ ok = $true; element = $info } | ConvertTo-Json -Compress -Depth 5
`;

export const PATTERN_SCRIPT =
  PREAMBLE +
  UIA_HELPERS +
  `
$op = [string]$A.op
$el = Get-ElementAtPoint ([int]$A.x) ([int]$A.y)
if ($null -eq $el) {
  @{ ok = $false; error = 'no UI element at that point' } | ConvertTo-Json -Compress
  exit 0
}
$result = @{ ok = $true; op = $op }
try {
  switch ($op) {
    'invoke' {
      $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $p.Invoke()
    }
    'toggle' {
      $p = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
      $p.Toggle()
      Start-Sleep -Milliseconds 150
      $result.state = [string]$p.Current.ToggleState
    }
    'expand' {
      $p = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      $p.Expand()
    }
    'collapse' {
      $p = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
      $p.Collapse()
    }
    'select' {
      $p = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      $p.Select()
    }
    default {
      $result = @{ ok = $false; error = ('unknown pattern op: ' + $op) }
    }
  }
} catch {
  $result = @{ ok = $false; error = ('element does not support ' + $op + ' (' + $_.Exception.Message + ') — fall back to act kind=click') }
}
$result | ConvertTo-Json -Compress -Depth 4
`;

export const WINDOW_SCRIPT =
  PREAMBLE +
  `
$h = Find-WindowHandle ([string]$A.title)
if ($h -eq [IntPtr]::Zero) {
  @{ ok = $false; error = 'window not found: ' + [string]$A.title } | ConvertTo-Json -Compress
  exit 0
}
$op = [string]$A.op
$SWP_NOZORDER = 0x0004
$SWP_NOSIZE = 0x0001
$SWP_NOMOVE = 0x0002
switch ($op) {
  'maximize' { [void][DeskNative]::ShowWindowAsync($h, 3) }
  'minimize' { [void][DeskNative]::ShowWindowAsync($h, 6) }
  'restore'  { [void][DeskNative]::ShowWindowAsync($h, 9) }
  'close'    { [void][DeskNative]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
  'move'     { [void][DeskNative]::SetWindowPos($h, [IntPtr]::Zero, [int]$A.x, [int]$A.y, 0, 0, ($SWP_NOZORDER -bor $SWP_NOSIZE)) }
  'resize'   { [void][DeskNative]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, [int]$A.width, [int]$A.height, ($SWP_NOZORDER -bor $SWP_NOMOVE)) }
  default {
    @{ ok = $false; error = ('unknown window op: ' + $op) } | ConvertTo-Json -Compress
    exit 0
  }
}
Start-Sleep -Milliseconds 350
$rect = New-Object 'DeskNative+RECT'
$hasRect = [DeskNative]::GetWindowRect($h, [ref]$rect)
$payload = @{ ok = $true; op = $op }
if ($hasRect -and $op -ne 'close') {
  $payload.window = @{ x = $rect.Left; y = $rect.Top; width = ($rect.Right - $rect.Left); height = ($rect.Bottom - $rect.Top) }
}
$payload | ConvertTo-Json -Compress -Depth 4
`;

export const WAIT_SCRIPT =
  PREAMBLE +
  UIA_HELPERS +
  `
$timeoutMs = if ($A.timeoutMs) { [Math]::Min([int]$A.timeoutMs, 30000) } else { 10000 }
$deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
$start = [DateTime]::UtcNow
$found = $false
$element = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $h = Find-WindowHandle ([string]$A.title)
  if ($h -ne [IntPtr]::Zero) {
    if (-not $A.name) {
      $found = $true
      break
    }
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
      $hits = @(Search-Elements $root ([string]$A.name) ([string]$A.role) 1 18)
      if ($hits.Count -gt 0) {
        $found = $true
        $element = $hits[0]
        break
      }
    } catch { }
  }
  Start-Sleep -Milliseconds 400
}
$elapsed = [int]([DateTime]::UtcNow - $start).TotalMilliseconds
$payload = @{ ok = $true; found = $found; elapsedMs = $elapsed }
if ($element) { $payload.element = $element }
if (-not $found) { $payload.hint = 'not found within ' + $timeoutMs + 'ms — the window/element may not exist yet; re-check with apps or snapshot' }
$payload | ConvertTo-Json -Compress -Depth 5
`;

export const FIND_SCRIPT =
  PREAMBLE +
  UIA_HELPERS +
  `
$h = Find-WindowHandle ([string]$A.title)
if ($h -eq [IntPtr]::Zero) {
  @{ ok = $false; error = 'window not found: ' + [string]$A.title } | ConvertTo-Json -Compress
  exit 0
}
if ($A.title) { [void][DeskNative]::FocusWindow($h) }
$sb = New-Object System.Text.StringBuilder 512
[void][DeskNative]::GetWindowText($h, $sb, 512)
$procId = [uint32]0
[void][DeskNative]::GetWindowThreadProcessId($h, [ref]$procId)
$root = [System.Windows.Automation.AutomationElement]::FromHandle($h)
$maxResults = if ($A.maxResults) { [int]$A.maxResults } else { 50 }
$hits = @(Search-Elements $root ([string]$A.name) ([string]$A.role) $maxResults 20)
@{
  ok = $true
  window = @{ title = $sb.ToString(); processId = [int]$procId }
  elements = $hits
  truncated = ($hits.Count -ge $maxResults)
} | ConvertTo-Json -Compress -Depth 6
`;

export const SCREENSHOT_SCRIPT =
  PREAMBLE +
  `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size)
if ($A.grid) {
  # Vision-fallback aid: a labeled 100px coordinate grid lets an image model
  # READ click coordinates off the screenshot instead of estimating pixels.
  $gridPen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::FromArgb(90, 0, 200, 255)), 1
  $gridFont = New-Object System.Drawing.Font -ArgumentList 'Consolas', 8, ([System.Drawing.FontStyle]::Bold)
  $gridBg = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(170, 0, 0, 0))
  $gridFg = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(255, 0, 255, 255))
  for ($gx = 100; $gx -lt $b.Width; $gx += 100) { $g.DrawLine($gridPen, $gx, 0, $gx, $b.Height) }
  for ($gy = 100; $gy -lt $b.Height; $gy += 100) { $g.DrawLine($gridPen, 0, $gy, $b.Width, $gy) }
  for ($gx = 200; $gx -lt $b.Width; $gx += 200) {
    for ($gy = 200; $gy -lt $b.Height; $gy += 200) {
      $label = "$gx,$gy"
      $size = $g.MeasureString($label, $gridFont)
      $g.FillRectangle($gridBg, $gx + 2, $gy + 2, $size.Width, $size.Height)
      $g.DrawString($label, $gridFont, $gridFg, $gx + 2, $gy + 2)
    }
  }
}
$marked = 0
if ($A.marks) {
  $pen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::Red), 2
  $font = New-Object System.Drawing.Font -ArgumentList 'Segoe UI', 9, ([System.Drawing.FontStyle]::Bold)
  $bgBrush = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(230, 200, 0, 0))
  foreach ($m in $A.marks) {
    $w = [Math]::Max([int]$m.w, 8)
    $h = [Math]::Max([int]$m.h, 8)
    $left = [int]($m.x - $w / 2)
    $top = [int]($m.y - $h / 2)
    $g.DrawRectangle($pen, $left, $top, $w, $h)
    $label = [string]$m.ref
    $size = $g.MeasureString($label, $font)
    $ly = [Math]::Max(0, $top - $size.Height)
    $g.FillRectangle($bgBrush, $left, $ly, $size.Width, $size.Height)
    $g.DrawString($label, $font, [System.Drawing.Brushes]::White, $left, $ly)
    $marked++
  }
}
$bmp.Save([string]$A.path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
@{ ok = $true; path = [string]$A.path; width = $b.Width; height = $b.Height; marked = $marked } | ConvertTo-Json -Compress
`;
