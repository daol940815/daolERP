<#
  daolERP 백업 로컬 보관 — 윈도우 작업 스케줄러에 "매일 받기"를 등록한다.
  실행(한 번만): powershell -ExecutionPolicy Bypass -File install-task.ps1 -Dest D:\daolERP-backup
  - 매일 10:00 실행. 그 시각에 PC가 꺼져 있었으면 켜진 뒤 바로 실행한다.
  - 지금 로그인한 윈도우 계정으로 실행한다(토큰이 이 계정에만 풀리므로).
  해제: Unregister-ScheduledTask -TaskName 'daolERP 백업 받기' -Confirm:$false
#>
param(
  [string]$Dest = 'D:\daolERP-backup',
  [int]$Keep = 60,
  [string]$At = '10:00'
)
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'pull-backups.ps1'
if (-not (Test-Path $script)) { throw "pull-backups.ps1 이 같은 폴더에 있어야 합니다" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -Dest `"$Dest`" -Keep $Keep"
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName 'daolERP 백업 받기' -Action $action -Trigger $trigger -Settings $settings `
  -Description 'GitHub의 daolERP 암호화 백업을 매일 이 PC로 받아 보관' -Force | Out-Null

Write-Host "등록 완료: 매일 $At, 저장 폴더 $Dest (최근 $Keep 개 보관)"
Write-Host "지금 한 번 받아 봅니다..."
& $script -Dest $Dest -Keep $Keep
