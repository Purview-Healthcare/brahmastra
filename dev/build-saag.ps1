# Regenerates lib\saag.js from the SAAG Claim Entry Tool workbook (sheet "Finalized SAAG").
#   powershell -ExecutionPolicy Bypass -File dev\build-saag.ps1 -Workbook "C:\path\SAAG_Claim_Entry_Tool.xlsx"
# Needs nothing but PowerShell: the .xlsx is unzipped and its XML read directly.
param(
  [Parameter(Mandatory = $true)][string]$Workbook,
  [string]$Sheet = "Finalized SAAG",
  [string]$Out = (Join-Path (Split-Path $PSScriptRoot -Parent) "lib\saag.js")
)
$ErrorActionPreference = "Stop"
$work = Join-Path $env:TEMP ("saag-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $work | Out-Null
Copy-Item -LiteralPath $Workbook "$work\book.zip"
Expand-Archive "$work\book.zip" "$work\x" -Force
$ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
[xml]$wb = Get-Content "$work\x\xl\workbook.xml" -Encoding UTF8
[xml]$rels = Get-Content "$work\x\xl\_rels\workbook.xml.rels" -Encoding UTF8
$ss = @()
if (Test-Path "$work\x\xl\sharedStrings.xml") {
  [xml]$sx = Get-Content "$work\x\xl\sharedStrings.xml" -Encoding UTF8
  $ss = @($sx.sst.si | ForEach-Object { ($_.SelectNodes(".//*[local-name()='t']") | ForEach-Object { $_.InnerText }) -join "" })
}
function ColIndex([string]$ref) { $letters = ($ref -replace "\d", ""); $n = 0; foreach ($ch in $letters.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }; return $n }
$sh = $wb.workbook.sheets.sheet | Where-Object { $_.name -eq $Sheet }
if (-not $sh) { throw "Sheet '$Sheet' not found. Sheets: " + (($wb.workbook.sheets.sheet | ForEach-Object { $_.name }) -join ", ") }
$rid = $sh.GetAttribute("id", $ns)
$target = ($rels.Relationships.Relationship | Where-Object { $_.Id -eq $rid }).Target -replace "^/xl/", ""
[xml]$sheet = Get-Content (Join-Path "$work\x\xl" $target) -Encoding UTF8
$rows = @()
foreach ($row in @($sheet.worksheet.sheetData.row)) {
  $cells = @{}
  foreach ($c in @($row.c)) {
    if ($null -eq $c) { continue }
    $i = ColIndex $c.r
    $v = ""
    if ($c.t -eq "s") { $v = $ss[[int]$c.v] }
    elseif ($c.t -eq "inlineStr") { $v = ($c.is.SelectNodes(".//*[local-name()='t']") | ForEach-Object { $_.InnerText }) -join "" }
    else { $v = [string]$c.v }
    $cells[$i] = ($v -replace "[\r\n\t]+", " ").Trim()
  }
  $rows += [pscustomobject]@{ Status = $cells[1]; Sub = $cells[2]; Action = $cells[3]; Bucket = $cells[4]; Eff = $cells[5] }
}
$data = $rows | Select-Object -Skip 1 | Where-Object { $_.Status -and $_.Sub -and $_.Action }
$statusOrder = @("Claim Paid", "Claim Not On File", "Unable to Get Status", "Claim Denied", "Partially Paid", "Claim In Process", "Claim Hold", "Claim Rejected")
$extra = @($data | ForEach-Object { $_.Status } | Where-Object { $statusOrder -notcontains $_ } | Sort-Object -Unique)
$statuses = @($statusOrder | Where-Object { $s = $_; $data | Where-Object { $_.Status -eq $s } | Select-Object -First 1 }) + $extra
$subs = @($data | ForEach-Object { $_.Sub } | Sort-Object -Unique)
$actions = @($data | ForEach-Object { $_.Action } | Sort-Object -Unique)
$effs = @($data | ForEach-Object { $_.Eff } | Where-Object { $_ } | Sort-Object -Unique)
$si = @{}; for ($i = 0; $i -lt $statuses.Count; $i++) { $si[$statuses[$i]] = $i }
$ui = @{}; for ($i = 0; $i -lt $subs.Count; $i++) { $ui[$subs[$i]] = $i }
$ai = @{}; for ($i = 0; $i -lt $actions.Count; $i++) { $ai[$actions[$i]] = $i }
$ei = @{}; for ($i = 0; $i -lt $effs.Count; $i++) { $ei[$effs[$i]] = $i }
$seen = @{}
$out = New-Object System.Collections.Generic.List[string]
foreach ($r in $data) {
  $k = "$($r.Status)|$($r.Sub)|$($r.Action)"
  if ($seen.ContainsKey($k)) { continue }
  $seen[$k] = 1
  $e = if ($r.Eff -and $ei.ContainsKey($r.Eff)) { $ei[$r.Eff] } else { -1 }
  $out.Add("[$($si[$r.Status]),$($ui[$r.Sub]),$($ai[$r.Action]),$e]")
}
$esc = { param($s) '"' + ($s -replace '\\', '\\\\' -replace '"', '\"') + '"' }
$js = "/* Purview SAAG matrix (Status / Sub-status / Action / Effective Matrix), generated from $(Split-Path $Workbook -Leaf) on $(Get-Date -Format yyyy-MM-dd).`n" +
      "   rows: [statusIndex, subStatusIndex, actionIndex, effectiveIndex]. Regenerate with dev\build-saag.ps1 when the matrix changes. */`n" +
      "window.SAAG = {`n  statuses: [" + (($statuses | ForEach-Object { & $esc $_ }) -join ", ") + "],`n  subStatuses: [" + (($subs | ForEach-Object { & $esc $_ }) -join ", ") + "],`n" +
      "  actions: [" + (($actions | ForEach-Object { & $esc $_ }) -join ", ") + "],`n  effective: [" + (($effs | ForEach-Object { & $esc $_ }) -join ", ") + "],`n  rows: [" + ($out -join ",") + "]`n};`n"
[IO.File]::WriteAllText($Out, $js, (New-Object System.Text.UTF8Encoding $false))
Remove-Item -Recurse -Force $work
Write-Host "Wrote $Out : $($statuses.Count) statuses, $($subs.Count) sub-statuses, $($actions.Count) actions, $($effs.Count) effective values, $($out.Count) combinations."
