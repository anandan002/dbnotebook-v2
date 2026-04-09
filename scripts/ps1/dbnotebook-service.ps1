[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Install", "Start", "Stop", "Status", "Uninstall", "RunService")]
    [string]$Action,

    [string]$ServiceName = "DBNotebook",
    [string]$DisplayName = "DBNotebook Service",
    [string]$Description = "DBNotebook Flask application service",
    [string]$RepoRoot,
    [string]$PythonExe,
    [string]$NssmExe,
    [string]$NodeDir = "D:\soft\node-v24.14.0-win-x64",
    [string]$BootstrapPythonExe = "D:\soft\python-3.11.9-embed-amd64\python.exe",
    [string]$FrontendBasePath = "/",
    [Alias("Host")]
    [string]$ListenHost = "0.0.0.0",
    [int]$Port = 7860,
    [string]$EnvFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $RepoRoot = (Resolve-Path (Join-Path $scriptRoot "..\..")).Path
}

if (-not $PythonExe) {
    $PythonExe = Join-Path $RepoRoot "venv\Scripts\python.exe"
}

if (-not $EnvFile) {
    $EnvFile = Join-Path $RepoRoot ".env"
}

if (-not $NssmExe) {
    $NssmExe = Join-Path $RepoRoot "scripts\tools\nssm\nssm.exe"
}

$ServiceRegPath = "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName"

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message"
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Ensure-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        throw "Administrator privileges are required for action '$Action'."
    }
}

function Test-ServiceExists {
    param([string]$Name)
    return $null -ne (Get-Service -Name $Name -ErrorAction SilentlyContinue)
}

function Invoke-Sc {
    param([string[]]$Arguments)
    $output = & sc.exe @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "sc.exe failed ($LASTEXITCODE): $($output -join [Environment]::NewLine)"
    }
    return $output
}

function Resolve-Nssm {
    param([string]$TargetPath)

    if (Test-Path -LiteralPath $TargetPath) {
        return (Resolve-Path -LiteralPath $TargetPath).Path
    }

    $targetDir = Split-Path -Parent $TargetPath
    if (-not (Test-Path -LiteralPath $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    $zipPath = Join-Path $env:TEMP "nssm-2.24.zip"
    $extractPath = Join-Path $env:TEMP "nssm-2.24"
    $downloadUrl = "https://nssm.cc/release/nssm-2.24.zip"

    if (-not (Test-Path -LiteralPath $zipPath)) {
        Write-Info "Downloading NSSM from $downloadUrl"
        Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing
    }

    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

    $candidates = @(
        (Join-Path $extractPath "nssm-2.24\win64\nssm.exe"),
        (Join-Path $extractPath "nssm-2.24\win32\nssm.exe")
    )

    $source = $null
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            $source = $candidate
            break
        }
    }

    if ($null -eq $source) {
        throw "NSSM executable not found after extraction in: $extractPath"
    }

    Copy-Item -LiteralPath $source -Destination $TargetPath -Force
    Write-Info "NSSM installed at: $TargetPath"
    return (Resolve-Path -LiteralPath $TargetPath).Path
}

function Invoke-Nssm {
    param(
        [string]$ExePath,
        [string[]]$Arguments,
        [switch]$AllowError
    )

    $output = & $ExePath @Arguments 2>&1
    if ($LASTEXITCODE -ne 0 -and -not $AllowError) {
        throw "nssm failed ($LASTEXITCODE): $($output -join [Environment]::NewLine)"
    }
    return $output
}

function Get-NpmCommand {
    param([string]$PreferredNodeDir)

    if (-not [string]::IsNullOrWhiteSpace($PreferredNodeDir)) {
        $preferredNpm = Join-Path $PreferredNodeDir "npm.cmd"
        if (Test-Path -LiteralPath $preferredNpm) {
            return $preferredNpm
        }

        throw "npm.cmd not found in required Node directory: $PreferredNodeDir"
    }

    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($null -ne $npm) {
        return $npm.Source
    }

    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($null -ne $npm) {
        return $npm.Source
    }

    return $null
}

function Get-AlembicCommand {
    param([string]$RepoPath)

    $venvAlembic = Join-Path $RepoPath "venv\Scripts\alembic.exe"
    if (Test-Path -LiteralPath $venvAlembic) {
        return $venvAlembic
    }

    $alembic = Get-Command alembic.exe -ErrorAction SilentlyContinue
    if ($null -ne $alembic) {
        return $alembic.Source
    }

    $alembic = Get-Command alembic -ErrorAction SilentlyContinue
    if ($null -ne $alembic) {
        return $alembic.Source
    }

    return $null
}

function Resolve-BootstrapPython {
    param([string]$PreferredPath)

    if (-not [string]::IsNullOrWhiteSpace($PreferredPath) -and (Test-Path -LiteralPath $PreferredPath)) {
        return (Resolve-Path -LiteralPath $PreferredPath).Path
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($null -ne $python) {
        return $python.Source
    }

    return $null
}

function Parse-EnvFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Environment file not found: $Path"
    }

    $envMap = [ordered]@{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            continue
        }

        if ($trimmed.StartsWith("export ")) {
            $trimmed = $trimmed.Substring(7).Trim()
        }

        if ($trimmed -notmatch '^(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?<value>.*)$') {
            continue
        }

        $key = $matches["key"]
        $value = $matches["value"].Trim()
        if ($value.Length -ge 2) {
            $quote = $value.Substring(0, 1)
            if (($quote -eq '"' -or $quote -eq "'") -and $value.EndsWith($quote)) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            else {
                $value = [Regex]::Replace($value, '\s+#.*$', "")
            }
        }

        $envMap[$key] = $value
    }

    return $envMap
}

function Normalize-FrontendBasePath {
    param([string]$PathValue)

    $candidate = ""
    if ($null -ne $PathValue) {
        $candidate = $PathValue.Trim()
    }
    if ([string]::IsNullOrWhiteSpace($candidate) -or $candidate -eq "/") {
        return "/"
    }

    if (-not $candidate.StartsWith("/")) {
        $candidate = "/$candidate"
    }

    $candidate = $candidate.TrimEnd("/")
    if ($candidate -eq "") {
        return "/"
    }

    return $candidate
}

function Set-ServiceEnvironment {
    param(
        [string]$Path,
        [System.Collections.IDictionary]$Variables
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }

    $multi = @()
    foreach ($entry in $Variables.GetEnumerator()) {
        $multi += "$($entry.Key)=$($entry.Value)"
    }

    New-ItemProperty -Path $Path -Name "Environment" -PropertyType MultiString -Value $multi -Force | Out-Null
}

function Load-ServiceEnvironment {
    param([string]$Path)

    $loaded = [ordered]@{}
    $raw = (Get-ItemProperty -Path $Path -Name "Environment" -ErrorAction SilentlyContinue).Environment
    if ($null -eq $raw) {
        return $loaded
    }

    $entries = @()
    if ($raw -is [string]) {
        $entries += $raw
    }
    else {
        $entries += $raw
    }

    foreach ($entry in $entries) {
        if ([string]::IsNullOrWhiteSpace($entry)) {
            continue
        }

        $idx = $entry.IndexOf("=")
        if ($idx -le 0) {
            continue
        }

        $key = $entry.Substring(0, $idx)
        $value = $entry.Substring($idx + 1)
        [Environment]::SetEnvironmentVariable($key, $value, "Process")
        $loaded[$key] = $value
    }

    return $loaded
}

function Assert-Prerequisites {
    param(
        [string]$RepoPath,
        [string]$PyExe,
        [string]$EnvPath,
        [string]$RequiredNodeDir
    )

    if (-not (Test-Path -LiteralPath $RepoPath)) {
        throw "Repo root does not exist: $RepoPath"
    }

    if (-not (Test-Path -LiteralPath $PyExe)) {
        throw "Python executable not found: $PyExe"
    }

    if (-not (Test-Path -LiteralPath $EnvPath)) {
        throw ".env file not found: $EnvPath"
    }

    if (-not (Test-Path -LiteralPath $RequiredNodeDir)) {
        throw "Required Node directory not found: $RequiredNodeDir"
    }

    $nodeExe = Join-Path $RequiredNodeDir "node.exe"
    if (-not (Test-Path -LiteralPath $nodeExe)) {
        throw "node.exe not found in required Node directory: $RequiredNodeDir"
    }

    $npm = Get-NpmCommand -PreferredNodeDir $RequiredNodeDir
    if ($null -eq $npm) {
        throw "npm.cmd not found in required Node directory: $RequiredNodeDir"
    }

    $frontendPath = Join-Path $RepoPath "frontend"
    if (-not (Test-Path -LiteralPath $frontendPath)) {
        throw "Frontend folder not found: $frontendPath"
    }
}

function Get-InstallRequirementsPath {
    param([string]$RepoPath)

    $requirementsPath = Join-Path $RepoPath "requirements.txt"
    if (-not (Test-Path -LiteralPath $requirementsPath)) {
        throw "requirements.txt not found: $requirementsPath"
    }

    if ($env:OS -ne "Windows_NT") {
        return $requirementsPath
    }

    $filteredPath = Join-Path $env:TEMP "dbnotebook-requirements-windows.txt"
    $lines = Get-Content -LiteralPath $requirementsPath
    $filteredLines = @()
    $excludePackages = @(
        "uvloop",
        "opentelemetry-api",
        "opentelemetry-exporter-otlp-proto-common",
        "opentelemetry-exporter-otlp-proto-grpc",
        "opentelemetry-instrumentation",
        "opentelemetry-instrumentation-asgi",
        "opentelemetry-instrumentation-fastapi",
        "opentelemetry-proto",
        "opentelemetry-sdk",
        "opentelemetry-semantic-conventions",
        "opentelemetry-util-http",
        "langfuse"
    )
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) {
            $filteredLines += $line
            continue
        }

        $baseName = ($trimmed -replace '\s+#.*$','' -replace '([<>=!~].*)$','').Trim().ToLowerInvariant()
        if ($excludePackages -contains $baseName) {
            continue
        }
        $filteredLines += $line
    }

    Set-Content -LiteralPath $filteredPath -Value $filteredLines -Encoding UTF8
    Write-Info "Using Windows-filtered requirements file: $filteredPath"
    return $filteredPath
}

function Install-VenvRequirements {
    param(
        [string]$RepoPath,
        [string]$PythonExe,
        [string]$LogPath = ""
    )

    $requirementsPath = Get-InstallRequirementsPath -RepoPath $RepoPath

    & $PythonExe -m pip install --upgrade pip 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to upgrade pip in venv."
    }

    & $PythonExe -m pip install -r $requirementsPath 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install Python dependencies from: $requirementsPath"
    }
}

function Ensure-Venv {
    param(
        [string]$RepoPath,
        [string]$TargetPythonExe,
        [string]$BootstrapPythonPath,
        [string]$LogPath = ""
    )

    if (Test-Path -LiteralPath $TargetPythonExe) {
        $existingAlembic = Join-Path $RepoPath "venv\Scripts\alembic.exe"
        if (-not (Test-Path -LiteralPath $existingAlembic)) {
            Write-Warn "Existing venv is incomplete (alembic.exe missing). Reinstalling dependencies."
            Install-VenvRequirements -RepoPath $RepoPath -PythonExe $TargetPythonExe -LogPath $LogPath
        }
        return $TargetPythonExe
    }

    $bootstrap = Resolve-BootstrapPython -PreferredPath $BootstrapPythonPath
    if ($null -eq $bootstrap) {
        throw "No usable Python found to create venv. Checked '$BootstrapPythonPath' and global PATH."
    }

    $venvPath = Join-Path $RepoPath "venv"
    Write-Info "venv not found. Creating venv using: $bootstrap"

    $venvCreated = $false
    $venvExitCode = 1
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # External tools may write to stderr for normal diagnostics; rely on exit code.
        $ErrorActionPreference = "Continue"
        & $bootstrap -m venv $venvPath 2>&1 | Out-Host
        $venvExitCode = $LASTEXITCODE
    }
    catch {
        Write-Warn "python -m venv failed: $($_.Exception.Message)"
        $venvExitCode = 1
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($venvExitCode -eq 0) {
        $venvCreated = $true
    }

    if (-not $venvCreated) {
        Write-Warn "python -m venv is unavailable in '$bootstrap'. Trying virtualenv fallback."
        $virtualenvPyz = Join-Path $env:TEMP "virtualenv.pyz"
        $virtualenvUrl = "https://bootstrap.pypa.io/virtualenv.pyz"

        if (-not (Test-Path -LiteralPath $virtualenvPyz)) {
            Write-Info "Downloading virtualenv.pyz from $virtualenvUrl"
            Invoke-WebRequest -Uri $virtualenvUrl -OutFile $virtualenvPyz -UseBasicParsing
        }

        $virtualenvExitCode = 1
        $previousErrorActionPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = "Continue"
            & $bootstrap $virtualenvPyz $venvPath 2>&1 | Out-Host
            $virtualenvExitCode = $LASTEXITCODE
        }
        catch {
            Write-Warn "virtualenv fallback failed: $($_.Exception.Message)"
            $virtualenvExitCode = 1
        }
        finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }

        if ($virtualenvExitCode -ne 0) {
            throw "Failed to create venv via virtualenv fallback using '$bootstrap'."
        }
    }

    $createdPython = Join-Path $venvPath "Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $createdPython)) {
        throw "venv was created but Python executable is missing: $createdPython"
    }
    Install-VenvRequirements -RepoPath $RepoPath -PythonExe $createdPython -LogPath $LogPath

    return $createdPython
}

function Invoke-LoggedCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$StepName,
        [string]$LogPath
    )

    Write-Info "$StepName..."
    $previousErrorActionPreference = $ErrorActionPreference
    $exitCode = 1
    try {
        # Many CLIs (alembic/pip/npm) write diagnostics to stderr even on success.
        # Rely on process exit code instead of PowerShell stderr semantics.
        $ErrorActionPreference = "Continue"
        & $FilePath @Arguments 2>&1 | Out-Host
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($exitCode -ne 0) {
        throw "$StepName failed with exit code $exitCode."
    }
}

function Install-ServiceAction {
    Ensure-Admin
    $script:PythonExe = Ensure-Venv -RepoPath $RepoRoot -TargetPythonExe $PythonExe -BootstrapPythonPath $BootstrapPythonExe
    $script:NssmExe = Resolve-Nssm -TargetPath $NssmExe
    Assert-Prerequisites -RepoPath $RepoRoot -PyExe $PythonExe -EnvPath $EnvFile -RequiredNodeDir $NodeDir

    $scriptPath = (Resolve-Path -LiteralPath $PSCommandPath).Path
    $powerShellExe = Join-Path $PSHOME "powershell.exe"
    if (-not (Test-Path -LiteralPath $powerShellExe)) {
        throw "PowerShell executable not found: $powerShellExe"
    }

    $envVars = Parse-EnvFile -Path $EnvFile
    if ($envVars.Count -eq 0) {
        throw "No KEY=VALUE pairs were parsed from: $EnvFile"
    }

    $serviceArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Action RunService -ServiceName `"$ServiceName`" -RepoRoot `"$RepoRoot`" -PythonExe `"$PythonExe`" -NssmExe `"$script:NssmExe`" -NodeDir `"$NodeDir`" -BootstrapPythonExe `"$BootstrapPythonExe`" -FrontendBasePath `"$FrontendBasePath`" -ListenHost `"$ListenHost`" -Port $Port"
    $logDir = Join-Path $RepoRoot "logs"
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $runtimeLog = Join-Path $logDir "windows-service.log"

    if (Test-ServiceExists -Name $ServiceName) {
        Write-Warn "Service '$ServiceName' already exists. Recreating with NSSM wrapper."
        try {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        }
        catch {}
        Invoke-Nssm -ExePath $script:NssmExe -Arguments @("remove", $ServiceName, "confirm") -AllowError | Out-Null
        try {
            Invoke-Sc -Arguments @("delete", $ServiceName) | Out-Null
        }
        catch {}
        Start-Sleep -Seconds 2
    }

    Invoke-Nssm -ExePath $script:NssmExe -Arguments @("install", $ServiceName, $powerShellExe, $serviceArgs) | Out-Null
    Invoke-Nssm -ExePath $script:NssmExe -Arguments @("set", $ServiceName, "AppDirectory", $RepoRoot) | Out-Null
    Invoke-Nssm -ExePath $script:NssmExe -Arguments @("set", $ServiceName, "DisplayName", $DisplayName) | Out-Null
    Invoke-Nssm -ExePath $script:NssmExe -Arguments @("set", $ServiceName, "Description", $Description) | Out-Null
    Invoke-Nssm -ExePath $script:NssmExe -Arguments @("set", $ServiceName, "Start", "SERVICE_AUTO_START") | Out-Null
    Invoke-Nssm -ExePath $script:NssmExe -Arguments @("set", $ServiceName, "ObjectName", "LocalSystem") | Out-Null
    Invoke-Nssm -ExePath $script:NssmExe -Arguments @("set", $ServiceName, "AppStdout", $runtimeLog) | Out-Null
    Invoke-Nssm -ExePath $script:NssmExe -Arguments @("set", $ServiceName, "AppStderr", $runtimeLog) | Out-Null
    Invoke-Nssm -ExePath $script:NssmExe -Arguments @("set", $ServiceName, "AppExit", "Default", "Restart") | Out-Null

    Invoke-Sc -Arguments @("failure", $ServiceName, "reset=", "86400", "actions=", "restart/5000/restart/5000/restart/5000") | Out-Null
    Set-ServiceEnvironment -Path $ServiceRegPath -Variables $envVars

    Write-Info "Service '$ServiceName' installed/updated with NSSM."
}

function Start-ServiceAction {
    Ensure-Admin
    if (-not (Test-ServiceExists -Name $ServiceName)) {
        throw "Service '$ServiceName' does not exist. Run Install first."
    }

    Start-Service -Name $ServiceName -ErrorAction Stop
    Write-Info "Service '$ServiceName' start requested."
}

function Stop-ServiceAction {
    Ensure-Admin
    if (-not (Test-ServiceExists -Name $ServiceName)) {
        throw "Service '$ServiceName' does not exist."
    }

    Stop-Service -Name $ServiceName -Force -ErrorAction Stop
    Write-Info "Service '$ServiceName' stop requested."
}

function Status-ServiceAction {
    if (-not (Test-ServiceExists -Name $ServiceName)) {
        Write-Warn "Service '$ServiceName' does not exist."
        return
    }

    $svc = Get-Service -Name $ServiceName -ErrorAction Stop
    $wmi = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'"
    $status = [PSCustomObject]@{
        Name      = $svc.Name
        Status    = $svc.Status.ToString()
        StartType = $wmi.StartMode
        Account   = $wmi.StartName
        PathName  = $wmi.PathName
    }
    $status | Format-List | Out-Host
}

function Uninstall-ServiceAction {
    Ensure-Admin
    if (-not (Test-ServiceExists -Name $ServiceName)) {
        Write-Warn "Service '$ServiceName' does not exist."
        return
    }

    try {
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    }
    catch {
        Write-Warn "Service stop raised an error: $($_.Exception.Message)"
    }

    $resolvedNssm = Resolve-Nssm -TargetPath $NssmExe
    Invoke-Nssm -ExePath $resolvedNssm -Arguments @("remove", $ServiceName, "confirm") -AllowError | Out-Null
    try {
        Invoke-Sc -Arguments @("delete", $ServiceName) | Out-Null
    }
    catch {}
    if (Test-Path -LiteralPath $ServiceRegPath) {
        Remove-Item -Path $ServiceRegPath -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Info "Service '$ServiceName' uninstalled."
}

function Run-ServiceAction {
    if (-not (Test-Path -LiteralPath $RepoRoot)) {
        throw "Repo root not found: $RepoRoot"
    }

    Set-Location -LiteralPath $RepoRoot
    $null = Load-ServiceEnvironment -Path $ServiceRegPath

    $env:PYTHONPATH = $RepoRoot
    $env:APP_PORT = "$Port"
    if (-not [string]::IsNullOrWhiteSpace($NodeDir)) {
        $env:Path = "$NodeDir;$($env:Path)"
    }

    $normalizedBasePath = Normalize-FrontendBasePath -PathValue $FrontendBasePath
    $env:VITE_APP_BASE_PATH = if ($normalizedBasePath -eq "/") { "/" } else { "$normalizedBasePath/" }
    $env:DBNOTEBOOK_BASE_PATH = $normalizedBasePath

    $logDir = Join-Path $RepoRoot "logs"
    if (-not (Test-Path -LiteralPath $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    $runtimeLog = Join-Path $logDir "windows-service.log"

    $script:PythonExe = Ensure-Venv -RepoPath $RepoRoot -TargetPythonExe $PythonExe -BootstrapPythonPath $BootstrapPythonExe -LogPath $runtimeLog

    $alembicExe = Get-AlembicCommand -RepoPath $RepoRoot
    if ($null -eq $alembicExe) {
        throw "alembic executable not found (expected venv\\Scripts\\alembic.exe)."
    }
    Invoke-LoggedCommand -FilePath $alembicExe -Arguments @("upgrade", "head") -StepName "Running alembic migrations" -LogPath $runtimeLog

    $npm = Get-NpmCommand -PreferredNodeDir $NodeDir
    if ($null -eq $npm) {
        throw "npm.cmd not found in required Node directory: $NodeDir"
    }

    Push-Location (Join-Path $RepoRoot "frontend")
    try {
        Invoke-LoggedCommand -FilePath $npm -Arguments @("ci") -StepName "Installing frontend dependencies (npm ci)" -LogPath $runtimeLog
        Invoke-LoggedCommand -FilePath $npm -Arguments @("run", "build") -StepName "Building frontend assets" -LogPath $runtimeLog
    }
    finally {
        Pop-Location
    }

    Write-Info "Starting DBNotebook application process."
    $previousErrorActionPreference = $ErrorActionPreference
    $appExitCode = 1
    try {
        # Runtime app logs can write to stderr without indicating fatal failure.
        # Keep service alive unless process exits non-zero.
        $ErrorActionPreference = "Continue"
        & $PythonExe -m dbnotebook --host $ListenHost --port $Port 2>&1 | Out-Host
        $appExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($appExitCode -ne 0) {
        throw "Application exited with code $appExitCode."
    }
}

try {
    switch ($Action) {
        "Install"   { Install-ServiceAction }
        "Start"     { Start-ServiceAction }
        "Stop"      { Stop-ServiceAction }
        "Status"    { Status-ServiceAction }
        "Uninstall" { Uninstall-ServiceAction }
        "RunService" { Run-ServiceAction }
        default {
            throw "Unknown action: $Action"
        }
    }
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}

exit 0
