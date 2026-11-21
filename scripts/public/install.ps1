# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Changed for a2ui-spectra: taken from scripts/public/install_cli.ps1 in
# a2ui-project/a2ui at commit 0888f88b2835c44abdc871505f3f395e5ee0177d, and
# changed in its names, its release tags, the two origins it reads, its
# refusal of Windows on arm64 and its version check, which takes three plain
# numbers alone, as a release's version is.

# Standalone, user-space installer for a2ui-spectra on Windows.
#
# Usage:
#   irm https://raw.githubusercontent.com/retz8/a2ui-spectra/main/scripts/public/install.ps1 | iex
#
# Options (via environment variables):
#   A2UI_SPECTRA_VERSION         Version to install (e.g., "0.1.0" or "v0.1.0"). Defaults to latest release.
#   A2UI_SPECTRA_INSTALL_DIR     Target install directory. Defaults to %LOCALAPPDATA%\Programs\a2ui-spectra\bin.
#   A2UI_SPECTRA_REPO            GitHub repository (owner/repo). Defaults to "retz8/a2ui-spectra".
#   A2UI_SPECTRA_GITHUB_URL      Origin of the release's files. Defaults to "https://github.com".
#   A2UI_SPECTRA_GITHUB_API_URL  Origin of the releases list. Defaults to "https://api.github.com".
#   A2UI_SPECTRA_SKIP_CHECKSUM   Set to "1" to bypass SHA-256 cryptographic verification.

& {
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"

    # Ensure TLS 1.2 is enabled for older PowerShell environments without overwriting other protocols
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $Repo = if ($env:A2UI_SPECTRA_REPO) { $env:A2UI_SPECTRA_REPO } else { "retz8/a2ui-spectra" }
    $ServerUrl = if ($env:A2UI_SPECTRA_GITHUB_URL) { $env:A2UI_SPECTRA_GITHUB_URL } else { "https://github.com" }
    $ApiUrl = if ($env:A2UI_SPECTRA_GITHUB_API_URL) { $env:A2UI_SPECTRA_GITHUB_API_URL } else { "https://api.github.com" }
    $InstallDir = if ($env:A2UI_SPECTRA_INSTALL_DIR) {
        $env:A2UI_SPECTRA_INSTALL_DIR -replace '[\\/]+$', ''
    } else {
        Join-Path $env:LOCALAPPDATA "Programs\a2ui-spectra\bin"
    }

    # The release has a windows-x64 binary alone, and Windows on ARM64 is not supported
    $NativeArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($NativeArch -ne "AMD64") {
        throw "Unsupported Windows architecture: $NativeArch. The a2ui-spectra binary requires an x64 host."
    }
    $Target = "windows-x64"

    $Version = $env:A2UI_SPECTRA_VERSION
    if (-not $Version -or $Version -eq "latest") {
        Write-Host "Resolving latest a2ui-spectra release from $ServerUrl/$Repo..."
        try {
            $Page = 1
            $Tag = $null
            while ($Page -le 5 -and -not $Tag) {
                $ReleaseUri = "$ApiUrl/repos/$Repo/releases?per_page=100&page=$Page"
                $Releases = Invoke-RestMethod -Uri $ReleaseUri -Headers @{ "Accept" = "application/vnd.github+json" }
                if (-not $Releases -or $Releases.Count -eq 0) {
                    break
                }
                $CliRelease = $Releases | Where-Object { $_.tag_name -like "v*" -and -not $_.prerelease -and -not $_.draft } | Select-Object -First 1
                if ($CliRelease) {
                    $Tag = $CliRelease.tag_name
                }
                $Page++
            }
            if ($Tag) {
                # Found tag
            } else {
                throw "No eligible 'v*' release found in repository $Repo."
            }
        } catch {
            throw "Could not resolve latest release: $($_.Exception.Message). Specify the version explicitly with: `$env:A2UI_SPECTRA_VERSION = '0.1.0'"
        }
    } else {
        if ($Version -like "v*") {
            $Tag = $Version
        } else {
            $Tag = "v$Version"
        }
    }

    $RawVersion = $Tag -replace "^v", ""
    if ($RawVersion -notmatch '\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z' -or $RawVersion -match '\.\.') {
        throw "Invalid a2ui-spectra version '$RawVersion'."
    }
    $Tag = "v$RawVersion"
    $ArchiveName = "a2ui-spectra-v$RawVersion-$Target.zip"
    $DownloadUrl = "$ServerUrl/$Repo/releases/download/$Tag/$ArchiveName"
    $ChecksumsUrl = "$ServerUrl/$Repo/releases/download/$Tag/checksums.txt"

    $TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

    try {
        $ZipPath = Join-Path $TempDir $ArchiveName
        Write-Host "Downloading a2ui-spectra ($Tag) for $Target..."
        try {
            Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing
        } catch {
            throw "Failed to download release archive from ${DownloadUrl}: $($_.Exception.Message)"
        }

        if (-not $env:A2UI_SPECTRA_SKIP_CHECKSUM -or $env:A2UI_SPECTRA_SKIP_CHECKSUM -ne "1") {
            $ChecksumsPath = Join-Path $TempDir "checksums.txt"
            Write-Host "Verifying cryptographic SHA-256 checksum..."
            try {
                Invoke-WebRequest -Uri $ChecksumsUrl -OutFile $ChecksumsPath -UseBasicParsing
            } catch {
                throw "Failed to download checksums.txt from ${ChecksumsUrl}: $($_.Exception.Message). Set `$env:A2UI_SPECTRA_SKIP_CHECKSUM = '1' to bypass."
            }

            $ChecksumContent = Get-Content $ChecksumsPath
            $ExpectedLine = $ChecksumContent | Where-Object { $_ -match "(\s|\*)" + [regex]::Escape($ArchiveName) + "$" } | Select-Object -First 1
            if (-not $ExpectedLine) {
                throw "Archive $ArchiveName not found in checksums.txt!"
            }
            $ExpectedHash = ($ExpectedLine.Trim() -split "\s+")[0].ToLower()
            $ActualHash = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
            if ($ActualHash -ne $ExpectedHash) {
                throw "Cryptographic checksum mismatch for $ArchiveName!`nExpected: $ExpectedHash`nActual:   $ActualHash"
            }
            Write-Host "[OK] SHA-256 checksum verified."
        } else {
            Write-Warning "A2UI_SPECTRA_SKIP_CHECKSUM=1 set; skipping checksum verification."
        }

        Write-Host "Installing to $InstallDir\a2ui-spectra.exe..."
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force

        $ExtractedExe = Join-Path $TempDir "a2ui-spectra.exe"
        if (-not (Test-Path $ExtractedExe)) {
            throw "Release archive did not contain 'a2ui-spectra.exe'."
        }

        # Stage and atomically replace executable (avoids sharing violations if a2ui-spectra.exe is active)
        $TargetExe = Join-Path $InstallDir "a2ui-spectra.exe"
        $StagedExe = Join-Path $InstallDir "a2ui-spectra.exe.new"
        $OldExe = Join-Path $InstallDir "a2ui-spectra.exe.old"
        Copy-Item -Path $ExtractedExe -Destination $StagedExe -Force
        Remove-Item -Path $OldExe -Force -ErrorAction SilentlyContinue
        if (Test-Path $TargetExe) { Move-Item -Path $TargetExe -Destination $OldExe -Force }
        Move-Item -Path $StagedExe -Destination $TargetExe -Force
        Remove-Item -Path $OldExe -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Successfully installed a2ui-spectra ($Tag) to $InstallDir\a2ui-spectra.exe"

        # Verify and update User PATH without expanding REG_EXPAND_SZ entries
        $EnvKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Environment")
        if (-not $EnvKey) {
            throw "Failed to open or create HKCU\Environment registry key."
        }
        try {
            $UserPath = [string]$EnvKey.GetValue("Path", "", [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
            $Normalized = $InstallDir -replace '[\\/]+$', ''
            $AlreadyPresent = $UserPath -split ";" | Where-Object { $_ } |
                Where-Object { ([Environment]::ExpandEnvironmentVariables($_) -replace '[\\/]+$', '') -eq $Normalized }
            if (-not $AlreadyPresent) {
                Write-Host "Adding $InstallDir to user PATH environment variable..."
                $NewUserPath = (@($UserPath.TrimEnd(";"), $InstallDir) | Where-Object { $_ }) -join ";"
                $EnvKey.SetValue("Path", $NewUserPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
                # Broadcast environment update so newly spawned shells inherit PATH
                [Environment]::SetEnvironmentVariable("A2UI_INSTALLER_REFRESH", "1", "User")
                [Environment]::SetEnvironmentVariable("A2UI_INSTALLER_REFRESH", $null, "User")
                $env:Path = "$env:Path;$InstallDir"
                Write-Host "[OK] Added $InstallDir to PATH."
            }
        } finally {
            if ($EnvKey) { $EnvKey.Dispose() }
        }

        Write-Host "`nGet started by opening a new terminal and running:"
        Write-Host "  a2ui-spectra --help"
    } finally {
        Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
