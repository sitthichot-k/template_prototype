<#
.SYNOPSIS
  Tier-aware docker compose wrapper (PowerShell).

.DESCRIPTION
  Pairs the correct --env-file with the correct overlay. Running an overlay on
  its own fails with "service has neither an image nor a build context",
  because the overlay only carries tier-specific differences - the base
  docker-compose.yml holds the actual service definitions. This wrapper makes
  that mistake impossible.

  The bash equivalent is scripts/compose.sh; both enforce the same guards.

.EXAMPLE
  .\scripts\compose.ps1 local up -d --build
  .\scripts\compose.ps1 local logs -f backend
  .\scripts\compose.ps1 production pull
#>

# Deliberately NOT an advanced script: no [CmdletBinding()], no [Parameter()].
# Both would add the common parameters, and PowerShell then binds `-d` to
# `-Debug` before it ever reaches docker - so `up -d` silently runs in the
# foreground. Plain `param` plus $args keeps every compose flag intact.
param(
    [ValidateSet('local', 'preproduction', 'production')]
    [string]$Tier
)

$ComposeArgs = $args

$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent $PSScriptRoot
Push-Location $rootDir

try {
    if ([string]::IsNullOrWhiteSpace($Tier)) {
        Write-Host "Usage: .\scripts\compose.ps1 <local|preproduction|production> <compose args...>"
        Write-Host "   e.g. .\scripts\compose.ps1 local up -d --build"
        exit 2
    }

    $envFile = ".env.$Tier"
    $overlay = "docker-compose.$Tier.yml"

    if (-not (Test-Path $envFile)) {
        Write-Error "Missing $envFile. Copy .env.example and fill it in first."
        exit 1
    }
    if (-not (Test-Path $overlay)) {
        Write-Error "Missing $overlay."
        exit 1
    }

    # Refuse to deploy the non-local tiers while placeholders remain. A
    # CHANGE_ME that reaches a running service is a password of "CHANGE_ME".
    if ($Tier -ne 'local') {
        if (Select-String -Path $envFile -Pattern 'CHANGE_ME' -Quiet) {
            Write-Host "Refusing to run: $envFile still contains CHANGE_ME placeholders." -ForegroundColor Red
            Write-Host "Resolve them from the secret manager first - see docs/guides/secrets-management.md." -ForegroundColor Red
            exit 1
        }
    }

    # Production must pin an immutable tag, or a rollback cannot reproduce what
    # was actually running.
    if ($Tier -eq 'production') {
        $tagLine = Select-String -Path $envFile -Pattern '^IMAGE_TAG=' | Select-Object -First 1
        $tag = if ($tagLine) { $tagLine.Line -replace '^IMAGE_TAG=', '' } else { '' }

        if ([string]::IsNullOrWhiteSpace($tag) -or $tag -eq 'latest') {
            $shown = if ([string]::IsNullOrWhiteSpace($tag)) { '<empty>' } else { $tag }
            Write-Host "Refusing to run: production requires an immutable IMAGE_TAG (got '$shown')." -ForegroundColor Red
            exit 1
        }
    }

    if (-not $ComposeArgs -or $ComposeArgs.Count -eq 0) {
        Write-Host "Usage: .\scripts\compose.ps1 <local|preproduction|production> <compose args...>"
        exit 2
    }

    $argumentList = @(
        '--env-file', $envFile,
        '-f', 'docker-compose.yml',
        '-f', $overlay
    ) + $ComposeArgs

    Write-Host "docker compose $($argumentList -join ' ')" -ForegroundColor DarkGray
    & docker compose @argumentList
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
