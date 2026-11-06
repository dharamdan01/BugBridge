$ErrorActionPreference = 'Stop'
$approvalStage = 'STARTUP'
$approvalAction = 'Run this script from the BugBridge root in the existing normal interactive Windows PowerShell terminal.'

function Stop-ApprovalEnrollment {
    param([string]$Code, [string]$Action)
    $approvalError = [System.InvalidOperationException]::new('Enrollment stopped safely.')
    $approvalError.Data['BugBridgeSafeCode'] = $Code
    $approvalError.Data['BugBridgeSafeAction'] = $Action
    throw $approvalError
}
function Read-ApprovalValue {
    param([string]$Prompt, [string]$MissingCode, [string]$MissingAction)
    try { $approvalValue = Read-Host -Prompt $Prompt }
    catch { Stop-ApprovalEnrollment 'INPUT_UNAVAILABLE' 'Read-Host is unavailable. Run .\scripts\enroll-approval-human.ps1 in a normal interactive PowerShell terminal, without -NonInteractive or redirected input.' }
    if ([string]::IsNullOrWhiteSpace($approvalValue)) { Stop-ApprovalEnrollment $MissingCode $MissingAction }
    return $approvalValue
}
function Invoke-ApprovalHelper {
    param([string]$Operation, [object]$InputValue)
    if ($null -eq $InputValue) { $approvalInputJson = '' }
    else { $approvalInputJson = $InputValue | ConvertTo-Json -Depth 8 -Compress }
    $approvalPreviousEncoding = $OutputEncoding
    try {
        # Windows PowerShell 5.1 defaults native stdin to ASCII. Preserve opaque
        # IDs exactly rather than replacing non-ASCII characters with '?'.
        $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $approvalLines = @($approvalInputJson | & $approvalNode $approvalHelper $Operation 2>$null)
        $approvalHelperExit = $LASTEXITCODE
    } finally { $OutputEncoding = $approvalPreviousEncoding }
    try { $approvalResponse = ($approvalLines -join "`n") | ConvertFrom-Json -ErrorAction Stop }
    catch { Stop-ApprovalEnrollment 'NODE_HELPER_FAILED' 'The Node helper did not return a valid result. Check Node.js availability and run node --check scripts/enrollment-config.mjs.' }
    if ($approvalHelperExit -ne 0 -or $approvalResponse.ok -ne $true) {
        if ($approvalResponse.code -match '^[A-Z_]+$' -and $approvalResponse.message) { Stop-ApprovalEnrollment $approvalResponse.code $approvalResponse.message }
        Stop-ApprovalEnrollment 'NODE_HELPER_FAILED' 'Enrollment helper failed. Inspect the fixed-path configuration with check-approval-readiness.mjs; no success is assumed.'
    }
    return $approvalResponse
}
try {
    if ($args.Count -ne 0) { Stop-ApprovalEnrollment 'UNSUPPORTED_ARGUMENTS' 'This interactive script accepts no arguments. Run .\scripts\enroll-approval-human.ps1.' }
    $approvalProject = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
    if ((Get-Location).Path -ne $approvalProject) { Stop-ApprovalEnrollment 'WRONG_DIRECTORY' 'Set-Location to the BugBridge project root, then run .\scripts\enroll-approval-human.ps1.' }
    $approvalStage = 'NODE_RUNTIME'
    $approvalAction = 'Use the existing supported Node.js runtime in this terminal; no credentials need to be changed.'
    $approvalNode = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    $approvalHelper = Join-Path $PSScriptRoot 'enrollment-config.mjs'
    $approvalStage = 'ACL_PRECHECK'
    $approvalAction = 'Run check-approval-acl.ps1 in the storage owner account. Do not reset or relax existing permissions.'
    [void](Invoke-ApprovalHelper 'check-acl' $null)
    Write-Host 'ACL VERIFIED. Continuing to human enrollment checks; no configuration has been written.'
    if (-not $env:SWITCH_ROOM_ID -or -not $env:SWITCH_AGENT_ID) { Stop-ApprovalEnrollment 'SWITCH_IDS_MISSING' 'Use the existing Switch-configured terminal with SWITCH_AGENT_ID and SWITCH_ROOM_ID loaded. Do not paste credentials or change the agent key.' }
    $approvalConfigPath = Join-Path $approvalProject '.bugbridge-private/approval-config.json'
    if (Test-Path -LiteralPath $approvalConfigPath) { Stop-ApprovalEnrollment 'CONFIG_EXISTS' 'Enrollment already exists. It will not be overwritten; review it locally with check-approval-readiness.mjs.' }
    Write-Host 'Supply identities verified through authenticated Switch administration. Display names, mentions and room membership are insufficient.'
    $approvalStage = 'HUMAN_ID'
    $approvalAction = 'Provide the independently verified full opaque HUMAN participant ID.'
    $approvalHumanId = Read-ApprovalValue 'Verified full HUMAN participant ID (not a display name)' 'HUMAN_ID_REQUIRED' $approvalAction
    $approvalStage = 'AGENT_PARTICIPANT_ID'
    $approvalAction = 'Provide the independently verified participant ID used by bug-triager; this differs from its registered SWITCH_AGENT_ID.'
    $approvalAgentSenderId = Read-ApprovalValue 'Verified existing AGENT participant ID (not its registered agent ID)' 'AGENT_PARTICIPANT_REQUIRED' $approvalAction
    $approvalStage = 'PUBLIC_KEY'
    $approvalAction = 'Obtain the human operator Ed25519 PUBLIC-key PEM from that operator or trusted key custodian. Do not supply a private key or invent a path.'
    $approvalPublicKeyPath = Read-ApprovalValue 'Absolute path to the existing human Ed25519 PUBLIC-key PEM' 'PUBLIC_KEY_REQUIRED' $approvalAction
    if (-not [System.IO.Path]::IsPathRooted($approvalPublicKeyPath) -or -not (Test-Path -LiteralPath $approvalPublicKeyPath -PathType Leaf)) { Stop-ApprovalEnrollment 'PUBLIC_KEY_NOT_FOUND' $approvalAction }
    $approvalPublicKeyFile = Get-Item -LiteralPath $approvalPublicKeyPath -Force
    if ($approvalPublicKeyFile.Length -gt 500 -or ($approvalPublicKeyFile.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { Stop-ApprovalEnrollment 'PUBLIC_KEY_INVALID' 'Use an existing Ed25519 PUBLIC-key PEM, at most 500 bytes, without a reparse-point file.' }
    $approvalPublicKey = [System.IO.File]::ReadAllText($approvalPublicKeyFile.FullName)
    if (-not $approvalPublicKey.StartsWith('-----BEGIN PUBLIC KEY-----')) { Stop-ApprovalEnrollment 'PUBLIC_KEY_INVALID' 'Only a PUBLIC KEY PEM is accepted. A private key is never enrollment input.' }
    $approvalConfig = @{
        version = 1; roomId = $env:SWITCH_ROOM_ID; agentId = $env:SWITCH_AGENT_ID
        agentSenderIds = @($approvalAgentSenderId)
        switchIdentity = @{ enabled = $false; verifiedDeployment = '' }
        authorizedHumans = @(@{ senderId = $approvalHumanId; publicKey = $approvalPublicKey })
    }
    $approvalStage = 'VALIDATION'
    $approvalAction = 'Check the independently verified IDs and the operator Ed25519 public key.'
    $approvalValidated = Invoke-ApprovalHelper 'validate' $approvalConfig
    Write-Host ('PUBLIC-key SPKI SHA-256 fingerprint: ' + $approvalValidated.fingerprint)
    Write-Host 'Compare this fingerprint with the human operator through a separate trusted channel before confirming. No private signing key is needed here.'
    $approvalStage = 'CONFIRMATION'
    $approvalConfirmation = Read-ApprovalValue 'Type ENROLL AUTHORIZED HUMAN only after verifying both identities and the public-key fingerprint' 'CONFIRMATION_REQUIRED' 'No enrollment occurs without the exact explicit confirmation.'
    if ($approvalConfirmation -cne 'ENROLL AUTHORIZED HUMAN') { Stop-ApprovalEnrollment 'CONFIRMATION_DECLINED' 'Cancelled. No human enrolled and no configuration written.' }
    $approvalStage = 'ATOMIC_WRITE'
    $approvalAction = 'Check owner access and local filesystem support. Never overwrite an existing configuration or retry automatically.'
    [void](Invoke-ApprovalHelper 'write-confirmed' @{ config = $approvalConfig; confirmation = $approvalConfirmation })
    $approvalStage = 'READINESS_VERIFICATION'
    $approvalAction = 'Configuration may be saved. Run check-approval-readiness.mjs and check-approval-acl.ps1 before using it; do not overwrite it.'
    $approvalReadinessLines = @(& $approvalNode (Join-Path $PSScriptRoot 'check-approval-readiness.mjs') 2>$null)
    $approvalReadinessExit = $LASTEXITCODE
    $approvalReadiness = ($approvalReadinessLines -join "`n") | ConvertFrom-Json -ErrorAction Stop
    if (-not (Test-Path -LiteralPath $approvalConfigPath -PathType Leaf) -or $approvalReadiness.enrollmentConfiguration -ne 'VALID' -or $approvalReadiness.patchExecutionEnabled -ne $false) { Stop-ApprovalEnrollment 'SAVED_CONFIG_REVIEW_REQUIRED' $approvalAction }
    Write-Host 'SAVED: .bugbridge-private/approval-config.json; enrollmentConfiguration: VALID.'
    Write-Host 'Switch metadata approval remains DISABLED; human identity/live mapping remain independently pending. No approval decision or patch executed.'
    if ($approvalReadinessExit -ne 0) { Write-Host 'Other readiness checks require review; run node scripts/check-approval-readiness.mjs before requesting a fix.' }
    exit 0
} catch {
    if ($_.Exception.Data['BugBridgeSafeCode']) { Write-Host ('Enrollment stopped [' + $_.Exception.Data['BugBridgeSafeCode'] + ']: ' + $_.Exception.Data['BugBridgeSafeAction']) }
    else { Write-Host ('Enrollment stopped [' + $approvalStage + ']: ' + $approvalAction) }
    Write-Host 'No success is assumed. Existing configuration/history and ACL permissions were not overwritten or relaxed. No fix applied.'
    exit 1
}
