# Прерывает всё, что сейчас озвучивается (Speak Clipboard, Stop-хук): System.Speech.Speak()
# синхронный, отменить его можно только убив процесс powershell, который его вызвал.
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
    Where-Object { $_.CommandLine -match 'on-stop\.ps1|speak-clipboard\.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
# piper.exe — дочерний процесс, не завершается автоматически вместе с родителем выше.
Get-Process -Name 'piper' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
