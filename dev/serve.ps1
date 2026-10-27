# Tiny static file server for local development (no Node needed).
#   powershell -ExecutionPolicy Bypass -File dev\serve.ps1 -Port 8787
# Serves the repository root (the folder above dev\) on http://localhost:<port>/
param(
  [int]$Port = 8787,
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)
$ErrorActionPreference = "Continue"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Brahmastra dev server: serving $Root at http://localhost:$Port/  (Ctrl+C to stop)"
$mime = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".mjs" = "text/javascript; charset=utf-8";
  ".css" = "text/css; charset=utf-8"; ".json" = "application/json; charset=utf-8"; ".map" = "application/json";
  ".png" = "image/png"; ".jpg" = "image/jpeg"; ".svg" = "image/svg+xml"; ".ico" = "image/x-icon"; ".wasm" = "application/wasm";
  ".csv" = "text/csv; charset=utf-8"; ".txt" = "text/plain; charset=utf-8"; ".md" = "text/markdown; charset=utf-8";
  ".xlsx" = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; ".sql" = "text/plain; charset=utf-8"
}
$rootFull = [IO.Path]::GetFullPath($Root)
while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($path.EndsWith("/")) { $path = $path + "index.html" }
    $file = [IO.Path]::GetFullPath((Join-Path $rootFull ($path.TrimStart("/") -replace "/", "\")))
    if (-not $file.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $ctx.Response.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes("Not found: $path")
      $ctx.Response.ContentType = "text/plain; charset=utf-8"
    } else {
      $bytes = [IO.File]::ReadAllBytes($file)
      $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] } else { $ctx.Response.ContentType = "application/octet-stream" }
    }
    $ctx.Response.Headers["Cache-Control"] = "no-store"
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    try { $ctx.Response.StatusCode = 500 } catch {}
  } finally {
    try { $ctx.Response.Close() } catch {}
  }
}
