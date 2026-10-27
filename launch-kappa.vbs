Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\xampp\htdocs\Test\KAPPA"
WshShell.Run "cmd /c npm run dev -- --port 5174", 0, False
WScript.Sleep 3000
WshShell.Run "http://localhost:5174", 1, False
