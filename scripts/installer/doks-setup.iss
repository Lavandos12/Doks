[Setup]
AppName=Doks
AppVersion=1.2.0
DefaultDirName={localappdata}\Programs\Doks
DefaultGroupName=Doks
OutputDir=..\..\dist-installer
OutputBaseFilename=Doks-Setup
SetupIconFile=..\tray-launcher\app.ico
Compression=lzma2/ultra64
SolidCompression=yes
PrivilegesRequired=lowest

[Files]
Source: "..\..\release\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs
Source: "..\..\Doks.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userdesktop}\Doks"; Filename: "{app}\Doks.exe"; IconFilename: "{app}\Doks.exe"
Name: "{group}\Doks"; Filename: "{app}\Doks.exe"; IconFilename: "{app}\Doks.exe"

[Run]
Filename: "{app}\Doks.exe"; Description: "Launch Doks"; Flags: postinstall nowait skipifsilent
