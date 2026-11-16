using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;

class Program
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBox(IntPtr hWnd, string text, string caption, uint type);

    static int Main(string[] args)
    {
        try
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            var appDir = Path.Combine(home, "px-studio");
            var pkg = Path.Combine(appDir, "package.json");
            if (!Directory.Exists(appDir) || !File.Exists(pkg))
            {
                MessageBox(IntPtr.Zero,
                    "PX STUDIO belum terinstal di folder pengguna.\n\nJalankan PXStudio-Setup terlebih dahulu.\nLokasi instalasi: " + appDir,
                    "PX STUDIO", 0x00000010);
                return 1;
            }

            var url = "http://localhost:3000";
            if (IsHealthy(url).GetAwaiter().GetResult())
            {
                OpenUrl(url);
                return 0;
            }

            // Try to start using px command if available, else npm start in appDir
            if (!StartServer(appDir))
            {
                MessageBox(IntPtr.Zero,
                    "Gagal menjalankan server PX STUDIO.\nPastikan Node.js/npm terpasang dan instalasi sudah benar.\n\nFolder: " + appDir,
                    "PX STUDIO", 0x00000010);
                return 1;
            }

            // Wait for server to become ready then open browser
            for (int i = 0; i < 60; i++)
            {
                System.Threading.Thread.Sleep(1000);
                if (IsHealthy(url).GetAwaiter().GetResult())
                {
                    OpenUrl(url);
                    return 0;
                }
            }

            // Open anyway (server may still be starting)
            OpenUrl(url);
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox(IntPtr.Zero, "Terjadi kesalahan: " + ex.Message, "PX STUDIO", 0x00000010);
            return 1;
        }
    }

    static bool StartServer(string appDir)
    {
        try
        {
            // Prefer npm.cmd start in app dir (reliable in user install)
            var npm = "npm.cmd";
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c cd /d \"" + appDir + "\" && npm run start",
                WorkingDirectory = appDir,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            Process.Start(psi);
            return true;
        }
        catch
        {
            return false;
        }
    }

    static async Task<bool> IsHealthy(string url)
    {
        try
        {
            using var c = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            var r = await c.GetAsync(url + "/api/health");
            return r.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    static void OpenUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
        catch { }
    }
}
