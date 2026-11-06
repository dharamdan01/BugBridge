$ErrorActionPreference = 'Stop'
try {
    if ($args.Count -ne 0) { throw 'This checker accepts no arguments.' }
    $approvalProject = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
    $approvalDirectory = [System.IO.Path]::GetFullPath((Join-Path $approvalProject '.bugbridge-private'))
    if ((Split-Path -Parent $approvalDirectory) -ne $approvalProject) { throw 'Unexpected storage path.' }
    if (-not (Test-Path -LiteralPath $approvalDirectory)) {
        @{ status = 'PENDING'; reason = 'STORAGE_NOT_CREATED'; modified = $false } | ConvertTo-Json -Compress
        exit 2
    }
    $approvalCurrentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $approvalAllowedSids = @($approvalCurrentSid, 'S-1-5-18', 'S-1-5-32-544')
    $approvalQueue = New-Object 'System.Collections.Generic.Queue[string]'
    $approvalQueue.Enqueue($approvalDirectory)
    $approvalChecked = 0
    while ($approvalQueue.Count -gt 0) {
        $approvalPath = $approvalQueue.Dequeue()
        $approvalItem = Get-Item -LiteralPath $approvalPath -Force
        if ($approvalPath -eq $approvalDirectory -and -not $approvalItem.PSIsContainer) { throw 'Storage root is not a directory.' }
        if (($approvalItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not permitted.' }
        $approvalDescriptor = Get-Acl -LiteralPath $approvalPath
        $approvalOwner = $approvalDescriptor.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
        if ($approvalAllowedSids -notcontains $approvalOwner) { throw 'Unreviewed storage owner.' }
        if ($approvalPath -eq $approvalDirectory -and -not $approvalDescriptor.AreAccessRulesProtected) { throw 'Root inheritance is not protected.' }
        $approvalRules = @($approvalDescriptor.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        if ($approvalRules.Count -eq 0) { throw 'Missing access rules.' }
        $approvalHasFullControl = $false
        foreach ($approvalRule in $approvalRules) {
            if ($approvalAllowedSids -notcontains $approvalRule.IdentityReference.Value) { throw 'Unreviewed ACL principal.' }
            if ($approvalRule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { throw 'Deny rule requires administrator review.' }
            if ($approvalRule.IdentityReference.Value -eq $approvalCurrentSid -and
                ($approvalRule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
                ($approvalRule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) {
                if ($approvalPath -ne $approvalDirectory -or
                    (($approvalRule.InheritanceFlags -band [System.Security.AccessControl.InheritanceFlags]::ContainerInherit) -ne 0 -and
                     ($approvalRule.InheritanceFlags -band [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) -ne 0)) {
                    $approvalHasFullControl = $true
                }
            }
        }
        if (-not $approvalHasFullControl) { throw 'Current operator lacks required direct/inherited access.' }
        $approvalChecked++
        if ($approvalItem.PSIsContainer) {
            foreach ($approvalChild in @(Get-ChildItem -LiteralPath $approvalPath -Force)) {
                $approvalQueue.Enqueue($approvalChild.FullName)
            }
        }
    }
    @{ status = 'VERIFIED'; checkedItems = $approvalChecked; modified = $false; scope = 'Current operator plus SYSTEM and Administrators; no unreviewed ACEs or reparse points' } | ConvertTo-Json -Compress
    exit 0
} catch {
    # Never output private paths, account identifiers, ACL bodies or exceptions.
    @{ status = 'PENDING'; reason = 'ACL_NOT_VERIFIED'; modified = $false } | ConvertTo-Json -Compress
    exit 1
}
