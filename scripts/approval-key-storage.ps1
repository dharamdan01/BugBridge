param(
    [Parameter(Mandatory = $true)][ValidateSet('Prepare', 'Verify', 'InspectParent')][string]$Operation,
    [Parameter(Mandatory = $true)][string]$Directory
)
$ErrorActionPreference = 'Stop'
$keyStage = 'PATH_VALIDATION'
try {
    $keyProject = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path.TrimEnd('\')
    if (-not [System.IO.Path]::IsPathRooted($Directory) -or $Directory.StartsWith('\\')) { throw 'Local absolute path required.' }
    $keyDirectory = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\')
    if ($keyDirectory.IndexOf(':', 2) -ge 0 -or $keyDirectory -eq $keyProject -or
        $keyDirectory.StartsWith($keyProject + '\', [System.StringComparison]::OrdinalIgnoreCase) -or
        $keyProject.StartsWith($keyDirectory + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe key location.' }
    $keyDrive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($keyDirectory))
    if ($keyDrive.DriveType -ne [System.IO.DriveType]::Fixed -or $keyDrive.DriveFormat -ne 'NTFS') { throw 'Local fixed NTFS required.' }
    $keySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $keyStage = 'ANCESTOR_VALIDATION'
    # Reject junctions/reparse points in every existing path component.
    $keyCursor = $keyDirectory
    while ($keyCursor) {
        if (Test-Path -LiteralPath (Join-Path $keyCursor '.git')) { throw 'Git repository storage refused.' }
        if (Test-Path -LiteralPath $keyCursor) {
            $keyItem = Get-Item -LiteralPath $keyCursor -Force
            if (-not $keyItem.PSIsContainer -or ($keyItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe path component.' }
        }
        $keyCursor = Split-Path -Parent $keyCursor
    }
    if ($Operation -in @('Prepare', 'InspectParent')) {
        $keyStage = 'PARENT_VALIDATION'
        if ($Operation -eq 'Prepare' -and (Test-Path -LiteralPath $keyDirectory)) { throw 'Existing key directory refused.' }
        $keyParent = Split-Path -Parent $keyDirectory
        if (-not (Test-Path -LiteralPath $keyParent -PathType Container)) { throw 'Parent must already exist.' }
        $keyStage = 'PARENT_ACL_READ'
        $keyParentAcl = Get-Acl -LiteralPath $keyParent
        $keyStage = 'PARENT_OWNER_CHECK'
        if ($keyParentAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $keySid.Value) { throw 'Parent must belong to the operator.' }
        # Prevent another ordinary principal from replacing the new directory.
        $keyPrivileged = @($keySid.Value, 'S-1-5-18', 'S-1-5-32-544')
        $keyWriteRights = [System.Security.AccessControl.FileSystemRights]'Write, Delete, DeleteSubdirectoriesAndFiles, ChangePermissions, TakeOwnership'
        $keyStage = 'PARENT_WRITE_CHECK'
        foreach ($keyRule in $keyParentAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
            if ($keyRule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
                ($keyRule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
                $keyPrivileged -notcontains $keyRule.IdentityReference.Value -and
                ($keyRule.FileSystemRights -band $keyWriteRights) -ne 0) { throw 'Parent grants unreviewed write access.' }
        }
        if ($Operation -eq 'InspectParent') {
            # Exact same parent/path guards as Prepare, without creating files,
            # changing permissions or reading any existing key material.
            @{ status = 'VERIFIED'; parentApproved = $true; modified = $false } | ConvertTo-Json -Compress
            exit 0
        }
        $keyStage = 'SECURE_DIRECTORY_CREATE'
        $keyDescriptor = New-Object System.Security.AccessControl.DirectorySecurity
        $keyDescriptor.SetOwner($keySid)
        $keyDescriptor.SetAccessRuleProtection($true, $false)
        [void]$keyDescriptor.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $keySid, [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow))
        # Windows PowerShell/.NET Framework overload creates with this DACL;
        # no secret is ever written into an inherited/broad directory first.
        [void][System.IO.Directory]::CreateDirectory($keyDirectory, $keyDescriptor)
    }
    $keyStage = 'DIRECTORY_VERIFICATION'
    $keyQueue = New-Object 'System.Collections.Generic.Queue[string]'
    $keyQueue.Enqueue($keyDirectory)
    $keyChecked = 0
    while ($keyQueue.Count -gt 0) {
        $keyPath = $keyQueue.Dequeue()
        $keyItem = Get-Item -LiteralPath $keyPath -Force
        if (($keyItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point refused.' }
        $keyAcl = Get-Acl -LiteralPath $keyPath
        if ($keyAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $keySid.Value) { throw 'Operator must own key storage.' }
        if ($keyPath -eq $keyDirectory -and -not $keyAcl.AreAccessRulesProtected) { throw 'Root inheritance must be disabled.' }
        $keyRules = @($keyAcl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
        if ($keyRules.Count -eq 0) { throw 'Missing owner access.' }
        $keyFull = $false
        foreach ($keyRule in $keyRules) {
            if ($keyRule.IdentityReference.Value -ne $keySid.Value -or $keyRule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { throw 'Owner-only DACL required.' }
            if (($keyRule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and
                ($keyRule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl) {
                if ($keyPath -ne $keyDirectory -or
                    (($keyRule.InheritanceFlags -band [System.Security.AccessControl.InheritanceFlags]::ContainerInherit) -ne 0 -and
                     ($keyRule.InheritanceFlags -band [System.Security.AccessControl.InheritanceFlags]::ObjectInherit) -ne 0)) { $keyFull = $true }
            }
        }
        if (-not $keyFull) { throw 'Missing effective/inheritable owner access.' }
        $keyChecked++
        if ($keyChecked -gt 10) { throw 'Unexpected key directory contents.' }
        if ($keyItem.PSIsContainer) {
            foreach ($keyChild in @(Get-ChildItem -LiteralPath $keyPath -Force)) {
                if ($keyChild.PSIsContainer -or $keyChild.Name -notin @('approval-private.pem', 'approval-public.pem')) { throw 'Unexpected key directory contents.' }
                $keyQueue.Enqueue($keyChild.FullName)
            }
        }
    }
    @{ status = 'VERIFIED'; ownerOnly = $true; checkedItems = $keyChecked } | ConvertTo-Json -Compress
    exit 0
} catch {
    # Fixed message only: never print key bytes, environment or raw exceptions.
    $keyKnownReasons = @{
        'Local absolute path required.' = 'LOCAL_ABSOLUTE_PATH_REQUIRED'
        'Unsafe key location.' = 'PROJECT_OR_UNSAFE_PATH'
        'Local fixed NTFS required.' = 'LOCAL_FIXED_NTFS_REQUIRED'
        'Git repository storage refused.' = 'GIT_ANCESTRY_FORBIDDEN'
        'Unsafe path component.' = 'REPARSE_OR_UNSAFE_ANCESTOR'
        'Existing key directory refused.' = 'DIRECTORY_ALREADY_EXISTS'
        'Parent must already exist.' = 'PARENT_NOT_FOUND'
        'Parent must belong to the operator.' = 'PARENT_OWNER_MISMATCH'
        'Parent grants unreviewed write access.' = 'PARENT_UNAUTHORIZED_WRITE'
        'Reparse point refused.' = 'REPARSE_POINT_FORBIDDEN'
        'Operator must own key storage.' = 'STORAGE_OWNER_MISMATCH'
        'Root inheritance must be disabled.' = 'ROOT_INHERITANCE_ENABLED'
        'Missing owner access.' = 'OWNER_ACCESS_MISSING'
        'Owner-only DACL required.' = 'NON_OWNER_ACL_RULE'
        'Missing effective/inheritable owner access.' = 'OWNER_FULL_CONTROL_MISSING'
        'Unexpected key directory contents.' = 'UNEXPECTED_STORAGE_CONTENTS'
    }
    $keyDetail = 'NATIVE_OPERATION_FAILED'
    if ($keyKnownReasons.ContainsKey($_.Exception.Message)) { $keyDetail = $keyKnownReasons[$_.Exception.Message] }
    @{ status = 'REFUSED'; reason = 'KEY_STORAGE_NOT_VERIFIED'; detail = $keyDetail; stage = $keyStage; helperLine = $_.InvocationInfo.ScriptLineNumber; action = 'Use a NEW directory outside BugBridge under an existing operator-owned local NTFS parent. Existing directories, broad ACLs and reparse points are refused; do not relax permissions.' } | ConvertTo-Json -Compress
    exit 1
}
