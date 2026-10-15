#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$TestHostName,
  [string]$DataRoot='D:\FAMNextData'
)
$ErrorActionPreference='Stop'
if ($TestHostName -notmatch '^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$') { throw 'Use a valid DNS hostname for the VM test site.' }
$dotnet=Get-Command dotnet -ErrorAction SilentlyContinue
if (!$dotnet) { throw 'Install the organisation-approved .NET LTS SDK and Hosting Bundle before building FAM Next.' }
$sdks=@(& dotnet --list-sdks)
if (!$sdks.Count) { throw '.NET SDK is installed incorrectly.' }
$web=Get-WindowsFeature Web-Server -ErrorAction SilentlyContinue
if (!$web -or !$web.Installed) { throw 'Install IIS Web Server before FAM Next deployment.' }
if (!(Get-Service | Where-Object { $_.Name -like 'MSSQL*' })) { throw 'Install SQL Server Developer/Express for the VM before schema deployment.' }
$drive=[IO.Path]::GetPathRoot([IO.Path]::GetFullPath($DataRoot))
if ([IO.DriveInfo]::new($drive).DriveType -ne [IO.DriveType]::Fixed) { throw 'FAM Next data must use a local fixed disk, never a network share.' }
New-Item -ItemType Directory -Force -Path $DataRoot,(Join-Path $DataRoot 'backups'),(Join-Path $DataRoot 'staging'),(Join-Path $DataRoot 'quarantine') | Out-Null
Write-Host 'FAM Next VM preflight passed.' -ForegroundColor Green
Write-Host ('Test HTTPS hostname: '+$TestHostName)
Write-Host ('Data root: '+$DataRoot)
Write-Host 'Next: create the SQL database, apply deploy\sql\001_initial.sql, then restore packages only from the approved NuGet feed.'
