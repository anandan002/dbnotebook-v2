[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("Install", "Start", "Stop", "Status", "Uninstall", "RunService", "Logs", "Health")]
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
    [int]$TailLines = 200,
    [int]$StartTimeoutSec = 900,
    [int]$HealthPollSec = 5,
    [string]$EnvFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:HasExplicitFrontendBasePath = $PSBoundParameters.ContainsKey("FrontendBasePath")

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

function Get-LogPaths {
    param([string]$RepoPath)

    $logDir = Join-Path $RepoPath "logs"
    [PSCustomObject]@{
        LogDir     = $logDir
        ServiceLog = Join-Path $logDir "windows-service.log"
        AppLog     = Join-Path $logDir "windows-app.log"
    }
}

function Ensure-LogDirectory {
    param([string]$RepoPath)

    $paths = Get-LogPaths -RepoPath $RepoPath
    if (-not (Test-Path -LiteralPath $paths.LogDir)) {
        New-Item -ItemType Directory -Path $paths.LogDir -Force | Out-Null
    }
    return $paths
}

function Write-ServiceLog {
    param(
        [string]$LogPath,
        [string]$Message,
        [string]$Level = "INFO"
    )

    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
    $line = "[$timestamp] [$Level] $Message"
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Write-PhaseLog {
    param(
        [string]$LogPath,
        [string]$Phase,
        [string]$State,
        [string]$Message = "",
        [string]$Level = "INFO"
    )

    $payload = "PHASE=$Phase STATE=$State"
    if (-not [string]::IsNullOrWhiteSpace($Message)) {
        $payload += " MESSAGE=$Message"
    }

    Write-ServiceLog -LogPath $LogPath -Message $payload -Level $Level
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

function Get-EnvMapValue {
    param(
        [System.Collections.IDictionary]$EnvVars,
        [string]$Key
    )

    if ($null -eq $EnvVars) {
        return $null
    }

    foreach ($entry in $EnvVars.GetEnumerator()) {
        if ([string]::Equals([string]$entry.Key, $Key, [System.StringComparison]::OrdinalIgnoreCase)) {
            return [string]$entry.Value
        }
    }

    return $null
}

function Resolve-ConfiguredBasePath {
    param(
        [string]$ArgumentValue,
        [bool]$HasExplicitArgument,
        [string]$EnvironmentValue
    )

    if ($HasExplicitArgument) {
        $normalized = Normalize-FrontendBasePath -PathValue $ArgumentValue
        return [PSCustomObject]@{
            BasePath = $normalized
            Source   = "service_arg"
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($EnvironmentValue)) {
        $normalized = Normalize-FrontendBasePath -PathValue $EnvironmentValue
        return [PSCustomObject]@{
            BasePath = $normalized
            Source   = "env"
        }
    }

    return [PSCustomObject]@{
        BasePath = "/"
        Source   = "default"
    }
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

function Get-ServiceEnvironmentMap {
    param([string]$RegistryPath)

    $loaded = [ordered]@{}
    $raw = (Get-ItemProperty -Path $RegistryPath -Name "Environment" -ErrorAction SilentlyContinue).Environment
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

function Assert-FrontendBuildOutput {
    param(
        [string]$RepoPath,
        [string]$ExpectedBasePath = "/"
    )

    $distPath = Join-Path $RepoPath "frontend\dist"
    $indexPath = Join-Path $distPath "index.html"

    if (-not (Test-Path -LiteralPath $distPath)) {
        throw "Frontend build output directory not found: $distPath"
    }

    if (-not (Test-Path -LiteralPath $indexPath)) {
        throw "Frontend build output is incomplete (missing $indexPath)"
    }

    $normalizedExpectedBasePath = Normalize-FrontendBasePath -PathValue $ExpectedBasePath
    $indexHtml = Get-Content -LiteralPath $indexPath -Raw

    if ($normalizedExpectedBasePath -ne "/") {
        $expectedPrefix = "$normalizedExpectedBasePath/assets/"
        if ($indexHtml -notmatch [Regex]::Escape($expectedPrefix)) {
            throw "Frontend build output base-path mismatch: expected asset prefix '$expectedPrefix' in $indexPath"
        }

        if ($indexHtml -match '(?:src|href)=["'']/assets/') {
            throw "Frontend build output contains root /assets paths while expected base path is '$normalizedExpectedBasePath'."
        }
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
        [string]$LogPath,
        [string]$PhaseName = ""
    )

    if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
        Write-ServiceLog -LogPath $LogPath -Message $StepName
        if (-not [string]::IsNullOrWhiteSpace($PhaseName)) {
            Write-PhaseLog -LogPath $LogPath -Phase $PhaseName -State "START" -Message $StepName
        }
    }
    else {
        Write-Info "$StepName..."
    }

    $stdoutPath = Join-Path $env:TEMP ("dbnotebook-cmd-out-{0}.log" -f ([guid]::NewGuid().ToString("N")))
    $stderrPath = Join-Path $env:TEMP ("dbnotebook-cmd-err-{0}.log" -f ([guid]::NewGuid().ToString("N")))
    $exitCode = 1
    try {
        $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -Wait -NoNewWindow -PassThru -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        $exitCode = [int]$proc.ExitCode

        if (Test-Path -LiteralPath $stdoutPath) {
            foreach ($line in Get-Content -LiteralPath $stdoutPath) {
                if ([string]::IsNullOrWhiteSpace($LogPath)) {
                    Write-Host $line
                }
                else {
                    Write-ServiceLog -LogPath $LogPath -Level "CMD" -Message $line
                }
            }
        }
        if (Test-Path -LiteralPath $stderrPath) {
            foreach ($line in Get-Content -LiteralPath $stderrPath) {
                if ([string]::IsNullOrWhiteSpace($LogPath)) {
                    Write-Host $line
                }
                else {
                    Write-ServiceLog -LogPath $LogPath -Level "CMDERR" -Message $line
                }
            }
        }
    }
    finally {
        Remove-Item -LiteralPath $stdoutPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
    }

    if ($exitCode -ne 0) {
        if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
            Write-ServiceLog -LogPath $LogPath -Level "ERROR" -Message "$StepName failed with exit code $exitCode."
            if (-not [string]::IsNullOrWhiteSpace($PhaseName)) {
                Write-PhaseLog -LogPath $LogPath -Phase $PhaseName -State "ERROR" -Message "$StepName failed with exit code $exitCode." -Level "ERROR"
            }
        }
        throw "$StepName failed with exit code $exitCode."
    }

    if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
        Write-ServiceLog -LogPath $LogPath -Message "$StepName completed."
        if (-not [string]::IsNullOrWhiteSpace($PhaseName)) {
            Write-PhaseLog -LogPath $LogPath -Phase $PhaseName -State "DONE" -Message "$StepName completed."
        }
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

    $envBasePath = Get-EnvMapValue -EnvVars $envVars -Key "DBNOTEBOOK_BASE_PATH"
    $resolvedBasePath = Resolve-ConfiguredBasePath -ArgumentValue $FrontendBasePath -HasExplicitArgument $script:HasExplicitFrontendBasePath -EnvironmentValue $envBasePath
    Write-Info "Install base path resolved to '$($resolvedBasePath.BasePath)' (source=$($resolvedBasePath.Source))."
    if ($resolvedBasePath.BasePath -eq "/") {
        Write-Warn "Frontend base path resolved to '/'. If this deployment is behind a subpath (example '/dbnotebook'), pass -FrontendBasePath '/dbnotebook' or set DBNOTEBOOK_BASE_PATH in .env."
    }

    # Persist resolved base path into service environment so runtime/frontend build always uses it.
    $envVars["DBNOTEBOOK_BASE_PATH"] = $resolvedBasePath.BasePath
    $envVars["VITE_APP_BASE_PATH"] = if ($resolvedBasePath.BasePath -eq "/") { "/" } else { "$($resolvedBasePath.BasePath)/" }

    $serviceArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -Action RunService -ServiceName `"$ServiceName`" -RepoRoot `"$RepoRoot`" -PythonExe `"$PythonExe`" -NssmExe `"$script:NssmExe`" -NodeDir `"$NodeDir`" -BootstrapPythonExe `"$BootstrapPythonExe`" -ListenHost `"$ListenHost`" -Port $Port"
    $serviceArgs += " -FrontendBasePath `"$($resolvedBasePath.BasePath)`""
    $logs = Ensure-LogDirectory -RepoPath $RepoRoot
    $runtimeLog = $logs.ServiceLog

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

    $svc = Get-Service -Name $ServiceName -ErrorAction Stop
    if ($svc.Status -ne "Running") {
        Start-Service -Name $ServiceName -ErrorAction Stop
        Write-Info "Service '$ServiceName' start requested."
    }
    else {
        Write-Warn "Service '$ServiceName' is already running. Validating readiness..."
    }

    if ($HealthPollSec -lt 1) {
        throw "-HealthPollSec must be at least 1."
    }
    if ($StartTimeoutSec -lt $HealthPollSec) {
        throw "-StartTimeoutSec must be greater than or equal to -HealthPollSec."
    }

    Write-Info "Waiting for readiness (timeout=${StartTimeoutSec}s, poll=${HealthPollSec}s)..."
    $readyDiag = Wait-ServiceReady -Name $ServiceName -ApiPort $Port -RepoPath $RepoRoot -TimeoutSec $StartTimeoutSec -PollSec $HealthPollSec
    Write-Info "Service '$ServiceName' is healthy (app pid=$($readyDiag.AppProcessId), port=$Port, /api/health=ok)."
}

function Stop-ServiceAction {
    Ensure-Admin
    if (-not (Test-ServiceExists -Name $ServiceName)) {
        throw "Service '$ServiceName' does not exist."
    }

    Stop-Service -Name $ServiceName -Force -ErrorAction Stop
    Write-Info "Service '$ServiceName' stop requested."
}

function Get-ServiceDescendantProcesses {
    param([int]$RootPid)

    if ($RootPid -le 0) {
        return @()
    }

    $all = Get-CimInstance Win32_Process
    $byParent = @{}
    foreach ($proc in $all) {
        $parentKey = [int]$proc.ParentProcessId
        if (-not $byParent.ContainsKey($parentKey)) {
            $byParent[$parentKey] = New-Object System.Collections.ArrayList
        }
        [void]$byParent[$parentKey].Add($proc)
    }

    $queue = New-Object System.Collections.Generic.Queue[int]
    $queue.Enqueue($RootPid)
    $result = New-Object System.Collections.ArrayList

    while ($queue.Count -gt 0) {
        $currentPid = $queue.Dequeue()
        if ($byParent.ContainsKey($currentPid)) {
            foreach ($child in $byParent[$currentPid]) {
                [void]$result.Add($child)
                $queue.Enqueue([int]$child.ProcessId)
            }
        }
    }

    return $result.ToArray()
}

function Test-PortListening {
    param([int]$LocalPort)

    try {
        $conn = Get-NetTCPConnection -State Listen -LocalPort $LocalPort -ErrorAction Stop | Select-Object -First 1
        return ($null -ne $conn)
    }
    catch {
        return $false
    }
}

function Get-ApiHealthState {
    param([int]$ApiPort)

    $url = "http://127.0.0.1:$ApiPort/api/health"
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($resp.StatusCode -ne 200) {
            return "http_$($resp.StatusCode)"
        }

        $payload = $null
        try {
            $payload = $resp.Content | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            return "invalid_json"
        }

        if ($null -ne $payload -and $payload.status -eq "ok") {
            return "ok"
        }

        return "unexpected_payload"
    }
    catch {
        return "unreachable"
    }
}

function Get-LogFileLastWrite {
    param([string]$Path)

    if (Test-Path -LiteralPath $Path) {
        return (Get-Item -LiteralPath $Path).LastWriteTime
    }
    return $null
}

function Get-ServiceLogPhaseSummary {
    param([string]$ServiceLogPath)

    $summary = [ordered]@{
        StartupPhase          = "unknown"
        StartupState          = "unknown"
        StartupPhaseMessage   = $null
        FrontendNpmCiState    = "unknown"
        FrontendBuildState    = "unknown"
        LastFrontendBuildTime = $null
        LastErrorHint         = $null
    }

    if (-not (Test-Path -LiteralPath $ServiceLogPath)) {
        return [PSCustomObject]$summary
    }

    $phaseRegex = [Regex]'PHASE=(?<phase>[A-Z_]+)\s+STATE=(?<state>[A-Z_]+)(?:\s+MESSAGE=(?<msg>.*))?'
    $timestampRegex = [Regex]'^\[(?<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})\]'
    $lines = Get-Content -LiteralPath $ServiceLogPath -Tail 800
    $serviceBootStartIndex = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match 'PHASE=SERVICE_BOOT\s+STATE=START') {
            $serviceBootStartIndex = $i
        }
    }
    $effectiveLines = if ($serviceBootStartIndex -ge 0) {
        $lines[$serviceBootStartIndex..($lines.Count - 1)]
    }
    else {
        $lines
    }

    foreach ($line in $effectiveLines) {
        $phaseMatch = $phaseRegex.Match($line)
        if ($phaseMatch.Success) {
            $phase = $phaseMatch.Groups["phase"].Value
            $state = $phaseMatch.Groups["state"].Value
            $msg = $phaseMatch.Groups["msg"].Value

            $summary.StartupPhase = $phase
            $summary.StartupState = $state
            $summary.StartupPhaseMessage = if ([string]::IsNullOrWhiteSpace($msg)) { $null } else { $msg }

            if ($phase -eq "FRONTEND_BUILD") {
                $summary.FrontendBuildState = $state
                $tsMatch = $timestampRegex.Match($line)
                if ($tsMatch.Success) {
                    try {
                        $summary.LastFrontendBuildTime = [datetime]::ParseExact($tsMatch.Groups["ts"].Value, "yyyy-MM-dd HH:mm:ss.fff", [System.Globalization.CultureInfo]::InvariantCulture)
                    }
                    catch {}
                }
            }
            elseif ($phase -eq "FRONTEND_NPM_CI") {
                $summary.FrontendNpmCiState = $state
            }
        }

        if ($line -match '\[ERROR\]' -or $line -match 'STATE=ERROR') {
            $summary.LastErrorHint = $line
        }
    }

    return [PSCustomObject]$summary
}

function Get-ServiceDiagnostics {
    param(
        [string]$Name,
        [int]$ApiPort,
        [string]$RepoPath
    )

    if (-not (Test-ServiceExists -Name $Name)) {
        return [PSCustomObject]@{
            ServiceExists = $false
            ServiceName   = $Name
        }
    }

    $svc = Get-Service -Name $Name -ErrorAction Stop
    $wmi = Get-CimInstance Win32_Service -Filter "Name='$Name'"
    if ($null -eq $wmi) {
        return [PSCustomObject]@{
            ServiceExists = $true
            Name          = $svc.Name
            Status        = $svc.Status.ToString()
            StartType     = "Unknown"
            Account       = "Unknown"
            PathName      = $null
            ServiceProcessId = $null
            AppProcessId     = $null
            AppCommandLine   = $null
            Port             = $ApiPort
            PortListening    = $false
            ApiHealth        = "unreachable"
        }
    }
    $servicePid = [int]$wmi.ProcessId
    $descendants = Get-ServiceDescendantProcesses -RootPid $servicePid
    $appProc = $descendants | Where-Object {
        ($_.Name -ieq "python.exe" -or $_.Name -ieq "pythonw.exe") -and
        ($_.CommandLine -match '(?i)-m\s+dbnotebook')
    } | Select-Object -First 1

    $logPaths = Get-LogPaths -RepoPath $RepoPath
    $frontendDistIndexPath = Join-Path $RepoPath "frontend\dist\index.html"
    $frontendDistIndexExists = Test-Path -LiteralPath $frontendDistIndexPath
    $portListening = Test-PortListening -LocalPort $ApiPort
    $apiHealth = Get-ApiHealthState -ApiPort $ApiPort
    $phaseSummary = Get-ServiceLogPhaseSummary -ServiceLogPath $logPaths.ServiceLog
    $serviceEnvMap = Get-ServiceEnvironmentMap -RegistryPath $ServiceRegPath
    $envBasePath = Get-EnvMapValue -EnvVars $serviceEnvMap -Key "DBNOTEBOOK_BASE_PATH"

    $appParameters = ""
    if (Test-Path -LiteralPath $NssmExe) {
        try {
            $appParametersRaw = & $NssmExe get $Name AppParameters 2>$null
            if ($LASTEXITCODE -eq 0 -and $null -ne $appParametersRaw) {
                $appParameters = ($appParametersRaw -join " ") -replace "`0", ""
            }
        }
        catch {}
    }

    $argBasePath = $null
    if ($appParameters -match '(?i)-FrontendBasePath\s+"?([^"\s]+)"?') {
        $argBasePath = $matches[1]
    }
    $baseResolution = Resolve-ConfiguredBasePath -ArgumentValue $argBasePath -HasExplicitArgument (-not [string]::IsNullOrWhiteSpace($argBasePath)) -EnvironmentValue $envBasePath

    return [PSCustomObject]@{
        ServiceExists        = $true
        Name                 = $svc.Name
        Status               = $svc.Status.ToString()
        StartType            = $wmi.StartMode
        Account              = $wmi.StartName
        PathName             = $wmi.PathName
        ServiceProcessId     = $servicePid
        AppProcessId         = if ($null -ne $appProc) { [int]$appProc.ProcessId } else { $null }
        AppCommandLine       = if ($null -ne $appProc) { $appProc.CommandLine } else { $null }
        Port                 = $ApiPort
        PortListening        = $portListening
        ApiHealth            = $apiHealth
        ServiceLogPath       = $logPaths.ServiceLog
        ServiceLogLastWrite  = Get-LogFileLastWrite -Path $logPaths.ServiceLog
        AppLogPath           = $logPaths.AppLog
        AppLogLastWrite      = Get-LogFileLastWrite -Path $logPaths.AppLog
        StartupPhase         = $phaseSummary.StartupPhase
        StartupState         = $phaseSummary.StartupState
        StartupPhaseMessage  = $phaseSummary.StartupPhaseMessage
        FrontendNpmCiState   = $phaseSummary.FrontendNpmCiState
        FrontendBuildState   = $phaseSummary.FrontendBuildState
        LastFrontendBuildTime = $phaseSummary.LastFrontendBuildTime
        FrontendDistIndexPath = $frontendDistIndexPath
        FrontendDistIndexExists = $frontendDistIndexExists
        LastErrorHint        = $phaseSummary.LastErrorHint
        ConfiguredBasePath   = $baseResolution.BasePath
        ConfiguredBaseSource = $baseResolution.Source
        EffectiveBasePath    = $baseResolution.BasePath
        ServiceArgBasePath   = if ([string]::IsNullOrWhiteSpace($argBasePath)) { $null } else { Normalize-FrontendBasePath -PathValue $argBasePath }
        EnvBasePath          = if ([string]::IsNullOrWhiteSpace($envBasePath)) { $null } else { Normalize-FrontendBasePath -PathValue $envBasePath }
    }
}

function Wait-ServiceReady {
    param(
        [string]$Name,
        [int]$ApiPort,
        [string]$RepoPath,
        [int]$TimeoutSec,
        [int]$PollSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $diag = Get-ServiceDiagnostics -Name $Name -ApiPort $ApiPort -RepoPath $RepoPath
        if ($diag.ServiceExists -and
            $diag.Status -eq "Running" -and
            $diag.AppProcessId -and
            $diag.PortListening -and
            $diag.ApiHealth -eq "ok") {
            return $diag
        }

        Start-Sleep -Seconds $PollSec
    }

    $finalDiag = Get-ServiceDiagnostics -Name $Name -ApiPort $ApiPort -RepoPath $RepoPath
    $issues = @()
    if (-not $finalDiag.ServiceExists) {
        $issues += "service does not exist"
    }
    else {
        if ($finalDiag.Status -ne "Running") {
            $issues += "service status is '$($finalDiag.Status)'"
        }
        if (-not $finalDiag.AppProcessId) {
            $issues += "dbnotebook app process not found"
        }
        if (-not $finalDiag.PortListening) {
            $issues += "port $ApiPort is not listening"
        }
        if ($finalDiag.ApiHealth -ne "ok") {
            $issues += "/api/health check is '$($finalDiag.ApiHealth)'"
        }
    }

    $phaseHint = "phase=$($finalDiag.StartupPhase)/$($finalDiag.StartupState)"
    if ($finalDiag.StartupPhaseMessage) {
        $phaseHint += " ($($finalDiag.StartupPhaseMessage))"
    }
    if ($finalDiag.LastErrorHint) {
        $phaseHint += "; last_error='$($finalDiag.LastErrorHint)'"
    }

    throw "Service readiness timed out after ${TimeoutSec}s: $($issues -join '; '); $phaseHint"
}

function Status-ServiceAction {
    $diag = Get-ServiceDiagnostics -Name $ServiceName -ApiPort $Port -RepoPath $RepoRoot
    if (-not $diag.ServiceExists) {
        Write-Warn "Service '$ServiceName' does not exist."
        return
    }

    $diag | Format-List | Out-Host
    Write-Info "Frontend bootstrap phases: npm_ci=$($diag.FrontendNpmCiState), build=$($diag.FrontendBuildState)"
    Write-Info "Frontend dist index present: $($diag.FrontendDistIndexExists) at $($diag.FrontendDistIndexPath)"
}

function Logs-ServiceAction {
    $paths = Ensure-LogDirectory -RepoPath $RepoRoot

    Write-Info "Service bootstrap log: $($paths.ServiceLog)"
    if (Test-Path -LiteralPath $paths.ServiceLog) {
        Get-Content -LiteralPath $paths.ServiceLog -Tail $TailLines | Out-Host
    }
    else {
        Write-Warn "No service log found yet."
    }

    Write-Info "App runtime log: $($paths.AppLog)"
    if (Test-Path -LiteralPath $paths.AppLog) {
        Get-Content -LiteralPath $paths.AppLog -Tail $TailLines | Out-Host
    }
    else {
        Write-Warn "No app log found yet."
    }
}

function Health-ServiceAction {
    $diag = Get-ServiceDiagnostics -Name $ServiceName -ApiPort $Port -RepoPath $RepoRoot
    if (-not $diag.ServiceExists) {
        throw "Service '$ServiceName' does not exist."
    }

    $issues = @()
    if ($diag.Status -ne "Running") {
        $issues += "service status is '$($diag.Status)'"
    }
    if (-not $diag.AppProcessId) {
        $issues += "dbnotebook app process not found"
    }
    if (-not $diag.PortListening) {
        $issues += "port $Port is not listening"
    }
    if ($diag.ApiHealth -ne "ok") {
        $issues += "/api/health check is '$($diag.ApiHealth)'"
    }

    if ($issues.Count -gt 0) {
        $summary = $issues -join "; "
        throw "Health check failed: $summary"
    }

    Write-Info "Health check passed (service running, process active, port $Port listening, /api/health ok)."
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
    $serviceEnvVars = Load-ServiceEnvironment -Path $ServiceRegPath

    $env:PYTHONPATH = $RepoRoot
    $env:APP_PORT = "$Port"
    if (-not [string]::IsNullOrWhiteSpace($NodeDir)) {
        $env:Path = "$NodeDir;$($env:Path)"
    }

    $envBasePath = Get-EnvMapValue -EnvVars $serviceEnvVars -Key "DBNOTEBOOK_BASE_PATH"
    $baseResolution = Resolve-ConfiguredBasePath -ArgumentValue $FrontendBasePath -HasExplicitArgument $script:HasExplicitFrontendBasePath -EnvironmentValue $envBasePath
    $normalizedBasePath = $baseResolution.BasePath
    $env:VITE_APP_BASE_PATH = if ($normalizedBasePath -eq "/") { "/" } else { "$normalizedBasePath/" }
    $env:DBNOTEBOOK_BASE_PATH = $normalizedBasePath

    $logs = Ensure-LogDirectory -RepoPath $RepoRoot
    $serviceLog = $logs.ServiceLog
    $appLog = $logs.AppLog

    Write-PhaseLog -LogPath $serviceLog -Phase "SERVICE_BOOT" -State "START" -Message "RunService started (RepoRoot=$RepoRoot, Port=$Port)."
    Write-ServiceLog -LogPath $serviceLog -Message "Using NodeDir: $NodeDir"
    Write-ServiceLog -LogPath $serviceLog -Message "Using frontend base path: $normalizedBasePath (source=$($baseResolution.Source))"
    Write-ServiceLog -LogPath $serviceLog -Message "Using VITE_APP_BASE_PATH: $($env:VITE_APP_BASE_PATH)"
    Write-ServiceLog -LogPath $serviceLog -Message "App runtime log path: $appLog"

    Write-PhaseLog -LogPath $serviceLog -Phase "VENV" -State "START" -Message "Ensuring Python virtual environment."
    $script:PythonExe = Ensure-Venv -RepoPath $RepoRoot -TargetPythonExe $PythonExe -BootstrapPythonPath $BootstrapPythonExe -LogPath $serviceLog
    Write-PhaseLog -LogPath $serviceLog -Phase "VENV" -State "DONE" -Message "Python virtual environment ready."

    $alembicExe = Get-AlembicCommand -RepoPath $RepoRoot
    if ($null -eq $alembicExe) {
        Write-PhaseLog -LogPath $serviceLog -Phase "MIGRATIONS" -State "ERROR" -Message "alembic executable not found." -Level "ERROR"
        throw "alembic executable not found (expected venv\\Scripts\\alembic.exe)."
    }
    Invoke-LoggedCommand -FilePath $alembicExe -Arguments @("upgrade", "head") -StepName "Running alembic migrations" -LogPath $serviceLog -PhaseName "MIGRATIONS"

    $npm = Get-NpmCommand -PreferredNodeDir $NodeDir
    if ($null -eq $npm) {
        Write-PhaseLog -LogPath $serviceLog -Phase "FRONTEND_NPM_CI" -State "ERROR" -Message "npm.cmd not found in required Node directory." -Level "ERROR"
        throw "npm.cmd not found in required Node directory: $NodeDir"
    }

    Push-Location (Join-Path $RepoRoot "frontend")
    try {
        $distPath = Join-Path $RepoRoot "frontend\dist"
        if (Test-Path -LiteralPath $distPath) {
            Write-ServiceLog -LogPath $serviceLog -Message "Removing existing frontend build output: frontend\\dist"
            Remove-Item -LiteralPath $distPath -Recurse -Force
        }

        Invoke-LoggedCommand -FilePath $npm -Arguments @("ci") -StepName "Installing frontend dependencies (npm ci)" -LogPath $serviceLog -PhaseName "FRONTEND_NPM_CI"
        Invoke-LoggedCommand -FilePath $npm -Arguments @("run", "build") -StepName "Building frontend assets" -LogPath $serviceLog -PhaseName "FRONTEND_BUILD"
    }
    finally {
        Pop-Location
    }
    Assert-FrontendBuildOutput -RepoPath $RepoRoot -ExpectedBasePath $normalizedBasePath
    Write-ServiceLog -LogPath $serviceLog -Message "Frontend build output verified: frontend\\dist\\index.html (base path: $normalizedBasePath)"

    Write-PhaseLog -LogPath $serviceLog -Phase "APP_START" -State "START" -Message "Starting DBNotebook application process."
    $previousErrorActionPreference = $ErrorActionPreference
    $appExitCode = 1
    try {
        # Write runtime app output into a dedicated log file for easier troubleshooting.
        $ErrorActionPreference = "Continue"
        & $PythonExe -m dbnotebook --host $ListenHost --port $Port 2>&1 | ForEach-Object {
            $line = $_.ToString()
            $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
            Add-Content -LiteralPath $appLog -Value "[$timestamp] $line" -Encoding UTF8
        }
        $appExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($appExitCode -ne 0) {
        Write-PhaseLog -LogPath $serviceLog -Phase "APP_START" -State "ERROR" -Message "Application exited with code $appExitCode." -Level "ERROR"
        Write-ServiceLog -LogPath $serviceLog -Level "ERROR" -Message "Application exited with code $appExitCode."
        throw "Application exited with code $appExitCode."
    }

    Write-PhaseLog -LogPath $serviceLog -Phase "APP_START" -State "DONE" -Message "Application process exited cleanly."
}

try {
    switch ($Action) {
        "Install"   { Install-ServiceAction }
        "Start"     { Start-ServiceAction }
        "Stop"      { Stop-ServiceAction }
        "Status"    { Status-ServiceAction }
        "Logs"      { Logs-ServiceAction }
        "Health"    { Health-ServiceAction }
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
