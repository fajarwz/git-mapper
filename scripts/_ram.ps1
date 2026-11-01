$ids1 = (Get-CimInstance Win32_Process -Filter "name = 'git-mapper.exe'").ProcessId
$ids2 = (Get-CimInstance Win32_Process -Filter "name = 'msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*git-mapper*' }).ProcessId
(Get-Process -Id ($ids1 + $ids2) -ErrorAction SilentlyContinue | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
