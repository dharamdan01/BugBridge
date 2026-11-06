$ErrorActionPreference = 'Stop'
try {
    if ($args.Count -ne 0) { throw 'This setup accepts no arguments.' }
    $approvalProject = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
    $approvalDirectory = [System.IO.Path]::GetFullPath((Join-Path $approvalProject '.bugbridge-private'))
    if ((Split-Path -Parent $approvalDirectory) -ne $approvalProject) { throw 'Unexpected storage path.' }
    if (Test-Path -LiteralPath $approvalDirectory) {
        Write-Output 'REFUSED: approval storage already exists. No permissions or history changed. Run check-approval-acl.ps1 and have the owner review any existing ACL issue.'
        exit 1
    }
    # Operator-invoked setup ONLY for a new empty directory. It never enrolls a
    # human, modifies credentials, reads keys or changes an existing ACL/history.
    $approvalCurrentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $approvalDescriptor = New-Object System.Security.AccessControl.DirectorySecurity
    $approvalDescriptor.SetAccessRuleProtection($true, $false)
    foreach ($approvalSid in @($approvalCurrentSid, [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
        $approvalRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $approvalSid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow)
        [void]$approvalDescriptor.AddAccessRule($approvalRule)
    }
    [void](New-Item -ItemType Directory -Path $approvalDirectory -ErrorAction Stop)
    Set-Acl -LiteralPath $approvalDirectory -AclObject $approvalDescriptor
    & (Join-Path $PSScriptRoot 'check-approval-acl.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'New ACL verification failed.' }
    Write-Output 'New private storage prepared. No human enrolled; no credentials or approval history created. Use this same Windows account for the runtime and ACL checks.'
} catch {
    Write-Output 'PENDING: approval storage could not be prepared and verified. Do not install enrollment data. An empty directory may remain; nothing was deleted. Ask its owner to inspect it.'
    exit 1
}
