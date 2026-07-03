$conns = Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue
if ($conns) {
    foreach ($conn in $conns) {
        $procId = $conn.OwningProcess
        if ($procId -gt 0) {
            try {
                Stop-Process -Id $procId -Force -ErrorAction Stop
                Write-Host "Killed process ${procId} on port 8787"
            } catch {
                Write-Host "Failed to kill process ${procId}"
            }
        }
    }
} else {
    Write-Host "No process on port 8787"
}