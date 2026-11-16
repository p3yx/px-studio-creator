Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = "C:\Users\Peyx\px-studio"
url = "http://localhost:3000"

Function PortOpen(port)
  On Error Resume Next
  Set xmlhttp = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  xmlhttp.setTimeouts 500, 500, 500, 500
  xmlhttp.open "GET", "http://127.0.0.1:" & port & "/", False
  xmlhttp.send
  If Err.Number = 0 Then
    PortOpen = True
  Else
    PortOpen = False
  End If
  Err.Clear
  On Error GoTo 0
End Function

If Not PortOpen(3000) Then
  WshShell.CurrentDirectory = appDir
  WshShell.Run "cmd /c npm run start", 0, False
  ' wait for server to become ready
  For i = 1 To 60
    WScript.Sleep 1000
    If PortOpen(3000) Then Exit For
  Next
End If

WshShell.Run url, 1, False
