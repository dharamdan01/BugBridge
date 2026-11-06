param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [ValidateSet('SecureRoot', 'AddParentWrite', 'AddStorageRead')][string]$Operation = 'SecureRoot'
)
$ErrorActionPreference = 'Stop'
try {
    # Test-only setup: tighten only a fresh EMPTY mkdtemp fixture directly in
    # this process's OS temp directory. Never repair a production/key directory.
    $fixtureRoot = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\')
    $fixtureParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
    if ((Split-Path -Parent $fixtureRoot) -ne $fixtureParent -or
        (Split-Path -Leaf $fixtureRoot) -notmatch '^bugbridge-test-keysetup-[a-zA-Z0-9]{6}$') { throw 'Unexpected fixture.' }
    $fixtureItem = Get-Item -LiteralPath $fixtureRoot -Force
    if (-not $fixtureItem.PSIsContainer -or ($fixtureItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Unsafe fixture.' }
    if ($Operation -eq 'SecureRoot' -and @(Get-ChildItem -LiteralPath $fixtureRoot -Force).Count -ne 0) { throw 'Fresh empty fixture required.' }
    $fixtureSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    $fixtureOriginalAcl = Get-Acl -LiteralPath $fixtureRoot
    if ($fixtureOriginalAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $fixtureSid.Value) { throw 'Not the fixture owner.' }
    $fixtureCursor = $fixtureRoot
    while ($fixtureCursor) {
        if (Test-Path -LiteralPath (Join-Path $fixtureCursor '.git')) { throw 'Fixture must be outside Git.' }
        $fixtureAncestor = Get-Item -LiteralPath $fixtureCursor -Force
        if (($fixtureAncestor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse ancestor refused.' }
        $fixtureCursor = Split-Path -Parent $fixtureCursor
    }
    if ($Operation -ne 'SecureRoot') {
        # Negative security tests deliberately corrupt ONLY a newly secured
        # synthetic fixture. Never permit this operation on existing real keys.
        if (-not $fixtureOriginalAcl.AreAccessRulesProtected) { throw 'Secure fixture prerequisite missing.' }
        $fixtureTarget = $fixtureRoot
        $fixtureRights = [System.Security.AccessControl.FileSystemRights]::Write
        if ($Operation -eq 'AddParentWrite') {
            if (Test-Path -LiteralPath (Join-Path $fixtureRoot 'new operator keys')) { throw 'Storage must not exist yet.' }
        } else {
            $fixtureTarget = Join-Path $fixtureRoot 'new operator keys'
            $fixtureStorage = Get-Item -LiteralPath $fixtureTarget -Force
            if (-not $fixtureStorage.PSIsContainer -or ($fixtureStorage.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
                @(Get-ChildItem -LiteralPath $fixtureTarget -Force).Count -ne 0) { throw 'Only empty test storage may be changed.' }
            $fixtureRights = [System.Security.AccessControl.FileSystemRights]::Read
        }
        $fixtureTargetAcl = Get-Acl -LiteralPath $fixtureTarget
        if ($fixtureTargetAcl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $fixtureSid.Value) { throw 'Not the fixture owner.' }
        # Build the test DACL explicitly. Do not round-trip owner/group/audit
        # metadata from Get-Acl through Set-Acl under a restricted test token.
        $fixtureNegativeAcl = New-Object System.Security.AccessControl.DirectorySecurity
        $fixtureNegativeAcl.SetAccessRuleProtection($true, $false)
        [void]$fixtureNegativeAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            $fixtureSid, [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow))
        [void]$fixtureNegativeAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
            [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0'), $fixtureRights,
            [System.Security.AccessControl.AccessControlType]::Allow))
        [System.IO.Directory]::SetAccessControl($fixtureTarget, $fixtureNegativeAcl)
        @{ status = 'NEGATIVE_TEST_FIXTURE_READY'; operation = $Operation } | ConvertTo-Json -Compress
        exit 0
    }
    $fixtureDescriptor = New-Object System.Security.AccessControl.DirectorySecurity
    $fixtureDescriptor.SetAccessRuleProtection($true, $false)
    [void]$fixtureDescriptor.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new(
        $fixtureSid, [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow))
    [System.IO.Directory]::SetAccessControl($fixtureRoot, $fixtureDescriptor)
    $fixtureVerified = Get-Acl -LiteralPath $fixtureRoot
    $fixtureRules = @($fixtureVerified.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
    if (-not $fixtureVerified.AreAccessRulesProtected -or
        $fixtureVerified.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $fixtureSid.Value -or
        $fixtureRules.Count -ne 1 -or $fixtureRules[0].IdentityReference.Value -ne $fixtureSid.Value -or
        $fixtureRules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
        $fixtureRules[0].FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
        $fixtureRules[0].InheritanceFlags -ne [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit') { throw 'Fixture ACL not verified.' }
    @{ status = 'VERIFIED'; ownerOnly = $true; empty = $true } | ConvertTo-Json -Compress
    exit 0
} catch {
    @{ status = 'REFUSED'; reason = 'SECURE_TEST_FIXTURE_NOT_PREPARED'; helperLine = $_.InvocationInfo.ScriptLineNumber; errorCategory = [string]$_.CategoryInfo.Category; exceptionType = $_.Exception.GetType().Name; hresult = $_.Exception.HResult } | ConvertTo-Json -Compress
    exit 1
}
