# Refreshes lib\denial-library.js from Purview Gurukul's index.html (the `const DATA = [...]` denial library
# and the DENIAL_ALIASES block). Point it at a local clone or an extracted download of the Gurukul repo.
#   powershell -ExecutionPolicy Bypass -File dev\build-denial-library.ps1 -GurukulIndex "C:\path\Purview-Gurukul\index.html"
param(
  [Parameter(Mandatory = $true)][string]$GurukulIndex,
  [string]$Out = (Join-Path (Split-Path $PSScriptRoot -Parent) "lib\denial-library.js")
)
$ErrorActionPreference = "Stop"
$lines = [IO.File]::ReadAllLines($GurukulIndex)
$dataLine = $lines | Where-Object { $_ -match '^\s*const DATA\s*=\s*\[' } | Select-Object -First 1
if (-not $dataLine) { throw "No 'const DATA = [' line found in $GurukulIndex" }
$json = ($dataLine -replace '^\s*const DATA\s*=\s*', '').Trim()
if ($json.EndsWith(";")) { $json = $json.Substring(0, $json.Length - 1) }
$parsed = $json | ConvertFrom-Json
$start = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^\s*const DENIAL_ALIASES\s*=') { $start = $i; break } }
$aliases = "window.DENIAL_ALIASES = {};"
if ($start -ge 0) {
  $end = $start
  for ($i = $start; $i -lt [Math]::Min($lines.Count, $start + 400); $i++) { if ($lines[$i] -match '^\};?\s*$') { $end = $i; break } }
  $aliases = ($lines[$start..$end] -join "`n") -replace '^\s*const DENIAL_ALIASES\s*=', 'window.DENIAL_ALIASES ='
  if (-not $aliases.TrimEnd().EndsWith(";")) { $aliases = $aliases.TrimEnd() + ";" }
}
$hdr = "/* Denial library from Purview Gurukul (github.com/Purview-Healthcare/Purview-Gurukul), copied $(Get-Date -Format yyyy-MM-dd).`n" +
       "   Each entry: name, codes (CARC), denial_wording, summary, questions to ask the payer, actions (next steps), keywords, family.`n" +
       "   Brahmastra uses it for the 'Suggested next steps' panel on a claim. Refresh with dev\build-denial-library.ps1. */`n"
[IO.File]::WriteAllText($Out, $hdr + "window.DENIAL_LIBRARY = " + $json + ";`n" + $aliases + "`n", (New-Object System.Text.UTF8Encoding $false))
Write-Host "Wrote $Out : $($parsed.Count) library entries."
