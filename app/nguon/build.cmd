@echo off
rem Bien dich XepGioHIS.exe bang trinh bien dich co san cua Windows (.NET Framework 4.x), khong can cai them gi.
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
"%CSC%" /nologo /codepage:65001 /target:winexe /optimize+ /out:"%~dp0..\XepGioHIS.exe" /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0XepGioHIS.cs"
