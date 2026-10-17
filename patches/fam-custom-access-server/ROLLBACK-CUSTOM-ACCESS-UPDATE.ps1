#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$BackupDirectory='', [string]$InstallRoot='C:\FAM', [string]$DataDir='C:\FAMData')
$ErrorActionPreference='Stop'
if(!$BackupDirectory){$BackupDirectory=Read-Host 'Full private backup directory printed by APPLY'}
if(!$BackupDirectory){throw 'No backup selected; nothing changed.'}
& (Join-Path $PSScriptRoot 'APPLY-CUSTOM-ACCESS-UPDATE.ps1') -InstallRoot $InstallRoot -DataDir $DataDir -RollbackBackup $BackupDirectory
