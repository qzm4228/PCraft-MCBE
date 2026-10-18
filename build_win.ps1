# Windows 构建脚本 - 统一使用 Python build_config.py
# 从配置文件读取内容调用 Python 构建工具

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

# 检测 Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Error "Python 未安装！请先安装 Python 3.x。\n构建脚本依赖 Python 执行。\n下载地址：https://www.python.org/downloads/"
    exit 1
}

# 确保在正确目录
Set-Location $root

# 检查 config 文件
$configFile = Join-Path $root 'config/packs.json'
if (-not (Test-Path $configFile)) {
    Write-Error "配置文件不存在: $configFile"
    exit 1
}

# 版本号只写在 config/version.json
$versionFile = Join-Path $root 'config/version.json'
if (Test-Path $versionFile) {
    $ver = (Get-Content $versionFile -Raw | ConvertFrom-Json).version
    Write-Host "🏷️ 版本: $ver (config/version.json)"
}

Write-Host "🔧 读取配置: $configFile"
Write-Host "📦 启动 Python 构建系统..."
Write-Host ""

# 执行 Python 构建脚本
& $python.Path (Join-Path $root 'tools_py/build_config.py')

cmd /c pause
