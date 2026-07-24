# Reusable, RELIABLE driver for recording the guide video, one module at a time.
# Dot-source it:  . scripts/guide-driver.ps1
# The whole point: encapsulate the things that kept drifting (window scroll moving the tabs,
# SendInput quirks) so each segment recording is a short, repeatable call that just works.
#
# Reliability rules baked in:
#  - Every tab navigation SCROLLS TO TOP first, so the tabs are always at their known Y.
#  - Typing uses SendInput with KEYEVENTF_UNICODE (WebView2 ignores keybd_event) and Size=40 INPUT.
#  - Coordinates are DISPLAY units (1280-wide reference); screen = disp*2 + client origin.
#  - The app no longer prints the full user path, so recordings need no crop.

Add-Type @"
using System;using System.Runtime.InteropServices;
public class G{
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
 [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] p, int size);
 [StructLayout(LayoutKind.Sequential, Size=40)] public struct INPUT{ public uint type; public KEYBDINPUT ki; }
 [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT{ public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr extra; }
 public struct RECT{public int l,t,r,b;} public struct POINT{public int x,y;}
 static int SZ = Marshal.SizeOf(typeof(INPUT));
 public static void Uni(char c){ INPUT[] a=new INPUT[2]; a[0].type=1;a[0].ki.wScan=(ushort)c;a[0].ki.dwFlags=0x0004; a[1].type=1;a[1].ki.wScan=(ushort)c;a[1].ki.dwFlags=0x0006; SendInput(2,a,SZ); }
 public static void Vk(ushort v){ INPUT[] a=new INPUT[2]; a[0].type=1;a[0].ki.wVk=v; a[1].type=1;a[1].ki.wVk=v;a[1].ki.dwFlags=0x0002; SendInput(2,a,SZ); }
}
"@
[G]::SetProcessDPIAware() | Out-Null
$script:App = (Get-Process -Name app -EA SilentlyContinue | Where-Object MainWindowTitle -eq 'PolyglotFormFill' | Select-Object -First 1)
if (-not $script:App) { throw "app not running" }
$script:H = $script:App.MainWindowHandle
$rc = New-Object G+RECT; [G]::GetClientRect($script:H,[ref]$rc) | Out-Null
$tl = New-Object G+POINT; $tl.x=0;$tl.y=0; [G]::ClientToScreen($script:H,[ref]$tl) | Out-Null
$script:OX = $tl.x; $script:OY = $tl.y; $script:SC = ($rc.r-$rc.l)/1280.0
function Front { [G]::ShowWindow($script:H,3)|Out-Null; [G]::SetForegroundWindow($script:H)|Out-Null; Start-Sleep -Milliseconds 300 }
function Click($dx,$dy){ Front; [G]::SetCursorPos([int]($dx*$script:SC+$script:OX),[int]($dy*$script:SC+$script:OY)); Start-Sleep -Milliseconds 120; [G]::mouse_event(0x02,0,0,0,0); [G]::mouse_event(0x04,0,0,0,0); Start-Sleep -Milliseconds 250 }
function Typ($t){ Front; foreach($ch in $t.ToCharArray()){ [G]::Uni($ch); Start-Sleep -Milliseconds 45 } }
function Key($vk){ [G]::Vk([uint16]$vk); Start-Sleep -Milliseconds 120 }
function Wheel($dx,$dy,$delta){ Front; [G]::SetCursorPos([int]($dx*$script:SC+$script:OX),[int]($dy*$script:SC+$script:OY)); Start-Sleep -Milliseconds 80; [G]::mouse_event(0x0800,0,0,[uint32]$delta,0); Start-Sleep -Milliseconds 250 }
function Drag($x1,$y1,$x2,$y2){ Front; $ax=[int]($x1*$script:SC+$script:OX);$ay=[int]($y1*$script:SC+$script:OY);$bx=[int]($x2*$script:SC+$script:OX);$by=[int]($y2*$script:SC+$script:OY); [G]::SetCursorPos($ax,$ay); Start-Sleep -Milliseconds 60; [G]::mouse_event(0x02,0,0,0,0); for($i=1;$i -le 20;$i++){ [G]::SetCursorPos([int]($ax+($bx-$ax)*$i/20),[int]($ay+($by-$ay)*$i/20)); Start-Sleep -Milliseconds 12 }; [G]::mouse_event(0x04,0,0,0,0); Start-Sleep -Milliseconds 120 }
function ScrollTop { Wheel 640 400 4000; Start-Sleep -Milliseconds 200; Wheel 640 400 4000; Start-Sleep -Milliseconds 300 }
# Tabs are at Y=150 ONLY when scrolled to top — so always scroll first.
$script:TabX = @{ license=87; profile=175; forms=283; past=378; guide=452 }
function Tab($name){ ScrollTop; Click $script:TabX[$name] 150; Start-Sleep -Milliseconds 500 }
