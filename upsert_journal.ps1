$ws = "workspaces/journal-hidden-workspace";
$journalDir = Join-Path $ws "journal";
$notesDir = Join-Path $ws "notes";
if (-not (Test-Path $journalDir)) { throw "Missing journal dir" }
if (-not (Test-Path $notesDir)) { New-Item -ItemType Directory -Path $notesDir | Out-Null }
Get-ChildItem $journalDir -Filter "journal-entry-*.md" | Sort-Object Name | ForEach-Object {
  $fileName = $_.Name
  $content = Get-Content $_.FullName -Raw
  $dateMatch = [regex]::Match($fileName, "(\d{4}-\d{2}-\d{2})")
  $dateKey = if ($dateMatch.Success) { $dateMatch.Groups[1].Value } else { $null }
  $titleMatch = [regex]::Match($content, "(?im)^\s*title\s*:\s*(.+?)\s*$")
  if ($titleMatch.Success -and $titleMatch.Groups[1].Value.Trim().Length -gt 0) {
    $title = $titleMatch.Groups[1].Value.Trim()
  } elseif ($dateKey) {
    try {
      $dt = [datetime]::ParseExact($dateKey, "yyyy-MM-dd", $null)
      $title = "Journal Entry - " + $dt.ToString("dddd, MMMM d, yyyy")
    } catch {
      $title = "Journal Entry - " + $dateKey
    }
  } else {
    $title = "Journal Entry"
  }
  $stem = [System.IO.Path]::GetFileNameWithoutExtension($fileName).ToLower()
  $nodeId = ($stem -replace "[^a-z0-9]+", "_").Trim("_")
  $relPath = "journal/$fileName"
  $jsonPath = Join-Path $notesDir "$nodeId.json"
  if (Test-Path $jsonPath) {
    $raw = Get-Content $jsonPath -Raw | ConvertFrom-Json
    $data = [ordered]@{}
    $data.id = if ($raw.id) { $raw.id } else { $nodeId }
    $data.name = $title
    $data.type = if ($raw.type) { $raw.type } else { "event" }
    $data.excerpt = if ($null -ne $raw.excerpt) { $raw.excerpt } else { "" }
    $data.notes = if ($null -ne $raw.notes) { $raw.notes } else { "" }
    $data.aliases = if ($raw.aliases) { @($raw.aliases) } else { @() }
    $data.tags = if ($raw.tags) { @($raw.tags) } else { @() }
    $data.connections = if ($raw.connections) { @($raw.connections) } else { @() }
    $data.originSourceFile = if ($raw.originSourceFile) { $raw.originSourceFile } else { $relPath }
    $data.sourceFile = $relPath
    if ($raw.additionalSourceFiles) { $data.additionalSourceFiles = @($raw.additionalSourceFiles | Where-Object { $_ -and $_ -ne $relPath } | Select-Object -Unique) }
    $data.documentNode = $true
    $data.createdAt = if ($raw.createdAt) { $raw.createdAt } else { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    $data.updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  } else {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $data = [ordered]@{
      id = $nodeId
      name = $title
      type = "event"
      excerpt = ""
      notes = ""
      aliases = @()
      tags = @()
      connections = @()
      originSourceFile = $relPath
      sourceFile = $relPath
      documentNode = $true
      createdAt = $now
      updatedAt = $now
    }
  }
  ($data | ConvertTo-Json -Depth 20) | Set-Content -Path $jsonPath -Encoding UTF8
  Write-Output ("{0} :: {1}" -f $nodeId, $title)
}
