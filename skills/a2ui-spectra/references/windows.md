# Spectra's loop on Windows

The loop of `SKILL.md` is the same on Windows. In PowerShell, these are written differently.

`curl` must be `curl.exe`, and a JSON body goes in on standard input, so its quotes survive:

```powershell
'{"text": "<message>"}' | curl.exe -s -X POST http://localhost:9820/api/message-box/messages -H 'content-type: application/json' -d '@-'
```

Start Spectra in the background, keeping its process id:

```powershell
New-Item -ItemType Directory -Force "$env:TEMP\a2ui-spectra" | Out-Null
$spectra = Start-Process a2ui-spectra -ArgumentList 'run --no-open --agent-url <agent-url> -- <agent-command>' -WindowStyle Hidden -PassThru -RedirectStandardOutput "$env:TEMP\a2ui-spectra\spectra.log" -RedirectStandardError "$env:TEMP\a2ui-spectra\spectra.err.log"
$spectra.Id | Set-Content "$env:TEMP\a2ui-spectra\spectra.pid"
```

Wait until the agent's card has answered:

```powershell
foreach ($i in 1..60) {
  $agent = curl.exe -s http://localhost:9820/api/agent
  if ($agent -match '"state":"running"') { break }
  Start-Sleep 1
}
$agent
```

Wait for a turn to close:

```powershell
foreach ($i in 1..180) {
  $code = curl.exe -s -o "$env:TEMP\a2ui-spectra\turn.json" -w '%{http_code}' http://localhost:9820/api/turns/<trace-id>
  if ($code -ne '409') { break }
  Start-Sleep 1
}
$code
```

Stop Spectra, and the agent with it:

```powershell
Stop-Process -Id (Get-Content "$env:TEMP\a2ui-spectra\spectra.pid")
```
