using System.Diagnostics;

class Program
{
    static int Main(string[] args)
    {
        Console.WriteLine("======================================");
        Console.WriteLine(" PX STUDIO - Setup (Per Pengguna)");
        Console.WriteLine("======================================");
        Console.WriteLine();

        try
        {
            var exeDir = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var sourceDir = FindSourceDir(exeDir);
            if (sourceDir == null)
            {
                Console.Error.WriteLine("Sumber instalasi tidak ditemukan.");
                Console.Error.WriteLine("Jalankan PXStudio-Setup dari folder paket PX STUDIO (yang berisi package.json). ");
                Pause();
                return 1;
            }

            if (!HasCommand("node") || !HasCommand("npm.cmd") && !HasCommand("npm"))
            {
                Console.Error.WriteLine("Node.js/npm tidak ditemukan. Install Node.js 20+ terlebih dahulu, lalu jalankan setup lagi.");
                Pause();
                return 1;
            }

            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var targetDir = Path.Combine(home, "px-studio");
            Console.WriteLine("Source : " + sourceDir);
            Console.WriteLine("Target : " + targetDir);
            Console.WriteLine();

            if (!PathsEqual(sourceDir, targetDir))
            {
                Console.WriteLine("Menyalin file aplikasi ke folder pengguna...");
                CopyDirectory(sourceDir, targetDir);
                Console.WriteLine("Salin selesai.");
            }
            else
            {
                Console.WriteLine("Setup dijalankan dari folder instalasi target. Melanjutkan konfigurasi...");
            }

            Console.WriteLine();
            Run("npm.cmd", "install", targetDir, "Instalasi dependency (npm install)...");

            Console.WriteLine();
            Run("npm.cmd", "run db:generate", targetDir, "Generate Prisma client...");

            Console.WriteLine();
            Run("npm.cmd", "run db:push", targetDir, "Menyiapkan database (db:push)...");

            Console.WriteLine();
            Run("npm.cmd", "run build", targetDir, "Build aplikasi (npm run build)...");

            Console.WriteLine();
            Run("npm.cmd", "link", targetDir, "Mendaftarkan perintah global 'px' (npm link)...", allowFail: true);

            Console.WriteLine();
            CreateLauncherShortcut(targetDir);

            Console.WriteLine();
            Console.WriteLine("======================================");
            Console.WriteLine(" Setup selesai.");
            Console.WriteLine(" Lokasi: " + targetDir);
            Console.WriteLine(" Jalankan: px studio start");
            Console.WriteLine(" Atau gunakan shortcut 'PX Studio' jika tersedia.");
            Console.WriteLine("======================================");
            Pause();
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine();
            Console.Error.WriteLine("Setup gagal: " + ex.Message);
            Pause();
            return 1;
        }
    }

    static string? FindSourceDir(string exeDir)
    {
        // Common cases: exe in package root, or in windows/publish subdir
        var candidates = new[]
        {
            exeDir,
            Directory.GetParent(exeDir)?.FullName,
            Directory.GetParent(exeDir)?.Parent?.FullName,
            Directory.GetParent(exeDir)?.Parent?.Parent?.FullName,
            Environment.CurrentDirectory
        };
        foreach (var c in candidates)
        {
            if (c == null) continue;
            var p = Path.Combine(c, "package.json");
            if (File.Exists(p) && Directory.Exists(Path.Combine(c, "src")))
                return Path.GetFullPath(c);
        }
        return null;
    }

    static bool PathsEqual(string a, string b)
    {
        try { return string.Equals(Path.GetFullPath(a).TrimEnd('\\','/'), Path.GetFullPath(b).TrimEnd('\\','/'), StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    static bool HasCommand(string name)
    {
        try
        {
            var p = Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c where " + name,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            });
            if (p == null) return false;
            p.WaitForExit();
            return p.ExitCode == 0;
        }
        catch { return false; }
    }

    static void Run(string file, string arguments, string cwd, string label, bool allowFail = false)
    {
        Console.WriteLine(label);
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c " + (file == "npm.cmd" ? "npm " + arguments : file + " " + arguments),
            WorkingDirectory = cwd,
            UseShellExecute = false,
            RedirectStandardOutput = false,
            RedirectStandardError = false,
            CreateNoWindow = false
        };
        using var p = Process.Start(psi);
        if (p == null) throw new Exception("Gagal menjalankan: " + file + " " + arguments);
        p.WaitForExit();
        if (p.ExitCode != 0 && !allowFail)
            throw new Exception($"Perintah gagal ({p.ExitCode}): npm {arguments}");
        if (p.ExitCode != 0 && allowFail)
            Console.WriteLine($"(Peringatan) langkah gagal/terlewat: npm {arguments} (kode {p.ExitCode}). Anda bisa jalankan manual nanti.");
    }

    static void CopyDirectory(string sourceDir, string targetDir)
    {
        var skip = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".git", "node_modules", ".next" };
        Directory.CreateDirectory(targetDir);
        foreach (var dir in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(sourceDir, dir);
            var parts = rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (parts.Any(p => skip.Contains(p))) continue;
            if (parts.Length > 0 && parts[0].Equals("storage", StringComparison.OrdinalIgnoreCase)) continue; // skip storage contents
            Directory.CreateDirectory(Path.Combine(targetDir, rel));
        }
        // ensure storage dir exists
        Directory.CreateDirectory(Path.Combine(targetDir, "storage"));

        foreach (var file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(sourceDir, file);
            var parts = rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (parts.Any(p => skip.Contains(p))) continue;
            if (parts.Length > 0 && parts[0].Equals("storage", StringComparison.OrdinalIgnoreCase)) continue;
            var dest = Path.Combine(targetDir, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            File.Copy(file, dest, true);
        }
    }

    static void CreateLauncherShortcut(string targetDir)
    {
        try
        {
            // Try to find published launcher exe near setup/source, else skip
            var exeDir = AppContext.BaseDirectory;
            var launcherCandidates = new[]
            {
                Path.Combine(exeDir, "PX Studio.exe"),
                Path.Combine(exeDir, "PXStudio.Launcher.exe"),
                Path.Combine(exeDir, "..", "PX Studio.exe"),
                Path.Combine(targetDir, "PX Studio.exe"),
            };
            string? launcher = launcherCandidates.Select(Path.GetFullPath).FirstOrDefault(File.Exists);
            if (launcher == null)
            {
                Console.WriteLine("Launcher .exe tidak ditemukan; lewati pembuatan shortcut. (Gunakan 'px studio start' dari terminal.)");
                return;
            }
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var shortcutPath = Path.Combine(desktop, "PX Studio.lnk");
            var ps = "$WshShell = New-Object -ComObject WScript.Shell; " +
                     "$Shortcut = $WshShell.CreateShortcut('" + shortcutPath.Replace("'", "''") + "'); " +
                     "$Shortcut.TargetPath = '" + launcher.Replace("'", "''") + "'; " +
                     "$Shortcut.WorkingDirectory = '" + Path.GetDirectoryName(launcher)!.Replace("'", "''") + "'; " +
                     "$Shortcut.IconLocation = '" + launcher.Replace("'", "''") + ",0'; " +
                     "$Shortcut.Save()";
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \"" + ps.Replace("\"", "\\\"") + "\"",
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            p?.WaitForExit();
            if (File.Exists(shortcutPath))
                Console.WriteLine("Shortcut desktop dibuat: " + shortcutPath);
            else
                Console.WriteLine("Gagal membuat shortcut desktop (bisa dibuat manual).");
        }
        catch (Exception ex)
        {
            Console.WriteLine("Lewati pembuatan shortcut: " + ex.Message);
        }
    }

    static void Pause()
    {
        Console.WriteLine();
        Console.Write("Tekan Enter untuk keluar...");
        try { Console.ReadLine(); } catch { }
    }
}
