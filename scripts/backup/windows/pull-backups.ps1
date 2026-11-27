<#
  daolERP 백업 로컬 보관 — GitHub에 있는 암호화 백업을 이 PC 폴더로 받아 온다.
  안내: docs/db-backup-track.md "로컬(회사 PC) 자동 보관"

  처음 한 번(토큰 등록):  powershell -ExecutionPolicy Bypass -File pull-backups.ps1 -SetToken
  받기(작업 스케줄러가 매일 실행): powershell -ExecutionPolicy Bypass -File pull-backups.ps1 -Dest D:\daolERP-backup

  - 아직 받지 않은 백업을 모두 받는다(PC가 꺼져 있던 날 것도 GitHub에 남아 있으면 받는다).
  - 파일은 암호화된 그대로(.tar.gz.gpg) 저장한다. 여는 방법은 문서 "백업 파일 열기".
  - 최근 $Keep 개(기본 60개 = 약 두 달)만 남기고 오래된 것은 지운다.
  - 달마다 그 달 첫 백업 1개는 monthly 폴더에 따로 $KeepMonths 개월(기본 12) 남긴다.
  - 토큰은 이 PC · 이 윈도우 계정에서만 풀리게 암호화해 저장한다(다른 PC로 복사해도 못 쓴다).
#>
param(
  [string]$Dest = 'D:\daolERP-backup',
  [int]$Keep = 60,
  [int]$KeepMonths = 12,
  [switch]$SetToken
)

$ErrorActionPreference = 'Stop'
$Repo = 'daol940815/daolERP'
$TokenFile = Join-Path $env:LOCALAPPDATA 'daolERP-backup\token.dat'

if ($SetToken) {
  $sec = Read-Host 'GitHub 토큰을 붙여 넣으세요(화면에 보이지 않습니다)' -AsSecureString
  New-Item -ItemType Directory -Force -Path (Split-Path $TokenFile) | Out-Null
  $sec | ConvertFrom-SecureString | Set-Content -Path $TokenFile
  Write-Host "토큰 저장 완료: $TokenFile"
  return
}

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$LogFile = Join-Path $Dest 'pull-backups.log'
function Log([string]$msg) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  Write-Host $line
}

try {
  if (-not (Test-Path $TokenFile)) { throw "토큰이 없습니다. 먼저 -SetToken 으로 등록하세요." }
  $sec = Get-Content $TokenFile | ConvertTo-SecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Add-Type -AssemblyName System.Net.Http
  # 다운로드 주소는 GitHub가 임시 저장소 주소로 넘겨준다(302). 그 주소에는 토큰을 보내지 않도록 자동 이동을 끈다.
  $handler = New-Object System.Net.Http.HttpClientHandler
  $handler.AllowAutoRedirect = $false
  $api = New-Object System.Net.Http.HttpClient($handler)
  $api.Timeout = [TimeSpan]::FromMinutes(30)
  $api.DefaultRequestHeaders.Add('Authorization', "Bearer $token")
  $api.DefaultRequestHeaders.Add('Accept', 'application/vnd.github+json')
  $api.DefaultRequestHeaders.Add('X-GitHub-Api-Version', '2022-11-28')
  $api.DefaultRequestHeaders.Add('User-Agent', 'daolERP-backup-pull')
  $plain = New-Object System.Net.Http.HttpClient
  $plain.Timeout = [TimeSpan]::FromMinutes(30)

  function GetJson([string]$url) {
    $res = $api.GetAsync($url).Result
    if (-not $res.IsSuccessStatusCode) {
      throw "GitHub 응답 $([int]$res.StatusCode) — 토큰 만료 · 권한(Actions 읽기) 확인"
    }
    return ($res.Content.ReadAsStringAsync().Result | ConvertFrom-Json)
  }

  # 남아 있는 백업 목록(최근 100개)
  $list = GetJson "https://api.github.com/repos/$Repo/actions/artifacts?per_page=100"
  $arts = @($list.artifacts | Where-Object { $_.name -like 'daolerp-backup-*' -and -not $_.expired } |
            Sort-Object created_at)

  $got = 0
  foreach ($a in $arts) {
    $target = Join-Path $Dest "$($a.name).tar.gz.gpg"
    if (Test-Path $target) { continue }

    $res = $api.GetAsync($a.archive_download_url).Result
    if ([int]$res.StatusCode -ge 300 -and [int]$res.StatusCode -lt 400) {
      $res = $plain.GetAsync($res.Headers.Location).Result
    }
    if (-not $res.IsSuccessStatusCode) { throw "$($a.name) 받기 실패: $([int]$res.StatusCode)" }

    $zip = Join-Path $Dest "$($a.name).zip"
    $fs = [IO.File]::Create($zip)
    try { $res.Content.CopyToAsync($fs).Wait() } finally { $fs.Close() }

    $tmp = Join-Path $Dest "_unzip_$($a.id)"
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $gpg = Get-ChildItem -Path $tmp -Filter '*.tar.gz.gpg' -Recurse | Select-Object -First 1
    if (-not $gpg) { throw "$($a.name): 묶음 안에 백업 파일이 없습니다" }
    Move-Item -Path $gpg.FullName -Destination $target
    Remove-Item -Recurse -Force $tmp
    Remove-Item -Force $zip
    $mb = [Math]::Round((Get-Item $target).Length / 1MB, 1)
    Log "받음: $($a.name) ($mb MB)"
    $got++
  }

  # 월별 보관: 달마다 그 달 첫 백업 1개를 monthly 폴더에 따로 남긴다(최근 $KeepMonths 개월)
  $monthly = Join-Path $Dest 'monthly'
  New-Item -ItemType Directory -Force -Path $monthly | Out-Null
  $all = @(Get-ChildItem -Path $Dest -Filter 'daolerp-backup-*.tar.gz.gpg' | Sort-Object Name)
  foreach ($grp in ($all | Group-Object { $_.Name.Substring(15, 6) })) {
    $have = @(Get-ChildItem -Path $monthly -Filter "daolerp-backup-$($grp.Name)*.tar.gz.gpg")
    if ($have.Count -eq 0) {
      Copy-Item -Path $grp.Group[0].FullName -Destination $monthly
      Log "월별 보관: $($grp.Group[0].Name)"
    }
  }
  @(Get-ChildItem -Path $monthly -Filter 'daolerp-backup-*.tar.gz.gpg' | Sort-Object Name -Descending) |
    Select-Object -Skip $KeepMonths | ForEach-Object { Remove-Item -Force $_.FullName; Log "월별 정리: $($_.Name)" }

  # 오래된 것 정리: 최근 $Keep 개만 남긴다
  $all = @(Get-ChildItem -Path $Dest -Filter 'daolerp-backup-*.tar.gz.gpg' | Sort-Object Name -Descending)
  if ($all.Count -gt $Keep) {
    $all | Select-Object -Skip $Keep | ForEach-Object {
      Remove-Item -Force $_.FullName
      Log "정리: $($_.Name)"
    }
  }

  $latest = if ($all.Count) { $all[0].Name } else { '없음' }
  Log "완료: 새로 받음 $got 개 · 보관 $([Math]::Min($all.Count, $Keep)) 개 · 최신 $latest"
}
catch {
  Log "실패: $($_.Exception.Message)"
  exit 1
}
