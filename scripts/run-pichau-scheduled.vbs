Option Explicit

Dim shell, fileSystem, scriptDir, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & _
  scriptDir & "\run-pichau-scheduled.ps1"""

shell.Run command, 0, False
