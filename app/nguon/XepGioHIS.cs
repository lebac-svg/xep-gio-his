// Bộ khởi động "Xếp giờ HIS".
// Việc nó làm: mở Chrome có sẵn trên máy với một hồ sơ riêng, rồi gắn file xepgio-helper.js vào các trang của HIS.
// Nó không cài gì vào Chrome thường dùng, không lưu mật khẩu, không gửi dữ liệu ra ngoài máy.
// Biên dịch bằng csc.exe có sẵn của Windows (xem build.cmd), mã viết theo C# 5.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace XepGioHIS
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    class MainForm : Form
    {
        readonly Label lblStatus = new Label();
        readonly ListBox lstLog = new ListBox();
        readonly Button btnQuit = new Button();
        readonly string baseDir = AppDomain.CurrentDomain.BaseDirectory;
        readonly JavaScriptSerializer ser = new JavaScriptSerializer();
        readonly CancellationTokenSource cts = new CancellationTokenSource();
        readonly SemaphoreSlim sendLock = new SemaphoreSlim(1, 1);
        readonly Dictionary<int, Action<Dictionary<string, object>>> pending = new Dictionary<int, Action<Dictionary<string, object>>>();
        readonly Dictionary<string, string> sessions = new Dictionary<string, string>();   // mã thẻ -> mã phiên
        ClientWebSocket ws;
        int nextId;
        string helper = "";
        bool hadPage;
        bool closing;

        // Cài đặt, đọc từ xepgio.config.json nằm cạnh file chạy
        string cfgUrl = "https://bvvinhphuc.vncare.vn/vnpthis/";
        string cfgHost = "bvvinhphuc.vncare.vn";
        string cfgProfile = "";
        string cfgChrome = "";
        string cfgExtraArgs = "";
        string cfgUpdate = "";   // địa chỉ thư mục chứa version.json và các file của bản mới nhất; để trống thì không tự cập nhật

        public MainForm()
        {
            ser.MaxJsonLength = int.MaxValue;
            Text = "Xếp giờ HIS";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }   // cửa sổ dùng luôn hình đại diện đã gắn trong file chạy
            ClientSize = new Size(440, 230);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(Screen.PrimaryScreen.WorkingArea.Right - 470, Screen.PrimaryScreen.WorkingArea.Bottom - 290);
            Font = new Font("Segoe UI", 9f);

            lblStatus.SetBounds(12, 10, 416, 40);
            lblStatus.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            lblStatus.Text = "Đang mở Chrome...";
            lstLog.SetBounds(12, 54, 416, 124);
            lstLog.HorizontalScrollbar = true;
            btnQuit.SetBounds(308, 188, 120, 30);
            btnQuit.Text = "Tắt app";
            btnQuit.Click += delegate { Close(); };
            Controls.Add(lblStatus);
            Controls.Add(lstLog);
            Controls.Add(btnQuit);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Task.Run(async delegate
            {
                try { await Start().ConfigureAwait(false); }
                catch (Exception ex) { if (!closing) Status("Lỗi: " + ex.Message); }
            });
        }

        // ---------- giao diện nhỏ ----------
        void Ui(Action a) { try { if (IsHandleCreated && !IsDisposed) BeginInvoke(a); } catch { } }
        void Status(string s) { Ui(delegate { lblStatus.Text = s; }); Log(s); }
        void Log(string s) { Ui(delegate { lstLog.Items.Add(DateTime.Now.ToString("HH:mm:ss") + "  " + s); lstLog.TopIndex = Math.Max(0, lstLog.Items.Count - 1); }); }

        static Dictionary<string, object> D(params object[] kv)
        {
            var d = new Dictionary<string, object>();
            for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
            return d;
        }
        static string Str(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) && v != null ? v.ToString() : "";
        }
        static Dictionary<string, object> Obj(Dictionary<string, object> d, string k)
        {
            object v;
            return d != null && d.TryGetValue(k, out v) ? v as Dictionary<string, object> : null;
        }

        // ---------- khởi động ----------
        void ReadConfig()
        {
            string p = Path.Combine(baseDir, "xepgio.config.json");
            if (File.Exists(p))
            {
                var c = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(p, Encoding.UTF8));
                if (Str(c, "url") != "") cfgUrl = Str(c, "url");
                if (Str(c, "host") != "") cfgHost = Str(c, "host");
                cfgProfile = Str(c, "profile");
                cfgChrome = Str(c, "chrome");
                cfgExtraArgs = Str(c, "extraArgs");
                cfgUpdate = Str(c, "update");
            }
            if (cfgProfile == "") cfgProfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "XepGioHIS", "chrome");
        }

        void LoadHelper()
        {
            string h = Path.Combine(baseDir, "xepgio-helper.js");
            if (!File.Exists(h)) throw new Exception("Không thấy file xepgio-helper.js cạnh file chạy.");
            helper = "window.__xepgioCfg=" + ser.Serialize(D("host", cfgHost, "url", cfgUrl)) + ";\n" + File.ReadAllText(h, Encoding.UTF8);
        }

        // ---------- tự cập nhật ----------
        // Mỗi lần mở app: đọc version.json ở địa chỉ "update", file nào khác bản đang có thì tải về, kiểm mã SHA-256 rồi mới thay.
        // Chỉ thay các file .js, .html, .json nằm cạnh file chạy; không tự thay file chạy và không đụng xepgio.config.json.
        // Không có mạng hoặc tải lỗi thì dùng bản đang có.
        static byte[] Download(string url)
        {
            ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072;   // TLS 1.2
            var rq = (HttpWebRequest)WebRequest.Create(url);
            rq.Timeout = 8000;
            rq.ReadWriteTimeout = 15000;
            rq.UserAgent = "XepGioHIS";
            rq.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            using (var rs = rq.GetResponse())
            using (var st = rs.GetResponseStream())
            using (var ms = new MemoryStream())
            {
                st.CopyTo(ms);
                return ms.ToArray();
            }
        }
        static string Sha256(byte[] b)
        {
            using (var h = System.Security.Cryptography.SHA256.Create())
                return BitConverter.ToString(h.ComputeHash(b)).Replace("-", "").ToLowerInvariant();
        }
        static Version Ver(string s)
        {
            Version v;
            if (s != null && s.IndexOf('.') < 0) s += ".0";
            return Version.TryParse(s, out v) ? v : new Version(0, 0);
        }
        static bool SafeName(string n)
        {
            if (string.IsNullOrEmpty(n) || n.Length > 60 || n.StartsWith(".")) return false;
            foreach (char ch in n) if (!(char.IsLetterOrDigit(ch) && ch < 128) && ch != '.' && ch != '-' && ch != '_') return false;
            string low = n.ToLowerInvariant();
            if (low == "xepgio.config.json") return false;
            return low.EndsWith(".js") || low.EndsWith(".html") || low.EndsWith(".json");
        }
        string LocalVersion()
        {
            try
            {
                string p = Path.Combine(baseDir, "version.json");
                if (!File.Exists(p)) return "0";
                string v = Str(ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(p, Encoding.UTF8)), "version");
                return v == "" ? "0" : v;
            }
            catch { return "0"; }
        }
        void CheckUpdate()
        {
            string local = LocalVersion();
            if (cfgUpdate == "") { Log("Bản " + local + ". Không đặt địa chỉ cập nhật."); return; }
            try
            {
                string baseUrl = cfgUpdate.EndsWith("/") ? cfgUpdate : cfgUpdate + "/";
                if (!baseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) && !baseUrl.StartsWith("http://127.0.0.1:"))
                { Log("Địa chỉ cập nhật phải bắt đầu bằng https, bỏ qua."); return; }
                Status("Đang kiểm tra bản mới...");
                string stamp = "?t=" + DateTime.UtcNow.Ticks;
                byte[] manBytes = Download(baseUrl + "version.json" + stamp);
                var man = ser.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(manBytes));
                string remote = Str(man, "version");
                if (remote == "") throw new Exception("version.json không ghi số bản");
                if (Ver(remote) < Ver(local)) { Log("Bản trên mạng (" + remote + ") cũ hơn bản đang có (" + local + "), giữ nguyên."); return; }
                object fo;
                var files = man.TryGetValue("files", out fo) ? fo as IEnumerable : null;
                var todo = new List<KeyValuePair<string, byte[]>>();
                if (files != null)
                {
                    foreach (object o in files)
                    {
                        var f = o as Dictionary<string, object>;
                        string name = Str(f, "name"), sha = Str(f, "sha256").ToLowerInvariant();
                        if (!SafeName(name) || sha.Length != 64) continue;
                        string p = Path.Combine(baseDir, name);
                        if (File.Exists(p) && Sha256(File.ReadAllBytes(p)) == sha) continue;
                        byte[] b = Download(baseUrl + name + stamp);
                        if (Sha256(b) != sha) throw new Exception("file " + name + " tải về không khớp mã kiểm tra");
                        todo.Add(new KeyValuePair<string, byte[]>(p, b));
                    }
                }
                // tải đủ và kiểm xong hết mới thay, để không bị nửa cũ nửa mới
                foreach (var kv in todo)
                {
                    if (File.Exists(kv.Key)) File.Copy(kv.Key, kv.Key + ".truoc", true);
                    File.WriteAllBytes(kv.Key, kv.Value);
                }
                File.WriteAllBytes(Path.Combine(baseDir, "version.json"), manBytes);
                Log(todo.Count > 0 ? "Đã cập nhật từ bản " + local + " lên bản " + remote + " (" + todo.Count + " file)." : "Đang dùng bản mới nhất (" + remote + ").");
                string exeSha = Str(Obj(man, "exe"), "sha256").ToLowerInvariant();
                if (exeSha.Length == 64 && Sha256(File.ReadAllBytes(Application.ExecutablePath)) != exeSha)
                    Log("Có file chạy XepGioHIS.exe mới. Tải lại gói tại: " + Str(man, "page"));
            }
            catch (Exception ex)
            {
                Log("Không kiểm tra được bản mới (" + ex.Message + "). Dùng bản đang có (" + local + ").");
            }
        }

        string FindChrome()
        {
            var list = new List<string>();
            if (cfgChrome != "") list.Add(cfgChrome);
            foreach (RegistryKey root in new RegistryKey[] { Registry.CurrentUser, Registry.LocalMachine })
            {
                try
                {
                    using (RegistryKey k = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"))
                    {
                        if (k != null && k.GetValue(null) != null) list.Add(k.GetValue(null).ToString());
                    }
                }
                catch { }
            }
            foreach (Environment.SpecialFolder f in new Environment.SpecialFolder[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86, Environment.SpecialFolder.LocalApplicationData })
                list.Add(Path.Combine(Environment.GetFolderPath(f), @"Google\Chrome\Application\chrome.exe"));
            string pf = Environment.GetEnvironmentVariable("ProgramW6432");
            if (!string.IsNullOrEmpty(pf)) list.Add(Path.Combine(pf, @"Google\Chrome\Application\chrome.exe"));
            foreach (string p in list) if (File.Exists(p)) return p;
            throw new Exception("Không tìm thấy Chrome trên máy này.");
        }

        static string HttpGet(string url)
        {
            var rq = (HttpWebRequest)WebRequest.Create(url);
            rq.Timeout = 1500;
            rq.Proxy = null;
            using (var rs = rq.GetResponse())
            using (var sr = new StreamReader(rs.GetResponseStream()))
                return sr.ReadToEnd();
        }

        // Chrome ghi cổng điều khiển vào file DevToolsActivePort trong thư mục hồ sơ. Cổng chỉ nghe trên chính máy này.
        string TryDebuggerUrl()
        {
            try
            {
                string f = Path.Combine(cfgProfile, "DevToolsActivePort");
                if (!File.Exists(f)) return null;
                string[] lines = File.ReadAllLines(f);
                int port;
                if (lines.Length == 0 || !int.TryParse(lines[0].Trim(), out port)) return null;
                var v = ser.Deserialize<Dictionary<string, object>>(HttpGet("http://127.0.0.1:" + port + "/json/version"));
                string u = Str(v, "webSocketDebuggerUrl");
                return u == "" ? null : u;
            }
            catch { return null; }
        }

        async Task Start()
        {
            ReadConfig();
            CheckUpdate();
            LoadHelper();
            string verNow = LocalVersion();
            Ui(delegate { Text = "Xếp giờ HIS " + verNow; });
            Directory.CreateDirectory(cfgProfile);
            string wsUrl = TryDebuggerUrl();
            bool reused = wsUrl != null;
            if (!reused)
            {
                try { File.Delete(Path.Combine(cfgProfile, "DevToolsActivePort")); } catch { }
                string chrome = FindChrome();
                // Ba thiết lập "disable-...": Chrome không làm chậm trang khi cửa sổ bị thu nhỏ hoặc bị che, để app vẫn điền đúng giờ trên máy dùng chung
                string args = "--remote-debugging-port=0 --user-data-dir=\"" + cfgProfile + "\" --no-first-run --no-default-browser-check"
                    + " --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows "
                    + cfgExtraArgs + " \"" + cfgUrl + "\"";
                Process.Start(new ProcessStartInfo(chrome, args) { UseShellExecute = false });
                Log("Đã mở Chrome: " + chrome);
                for (int i = 0; i < 120 && wsUrl == null && !closing; i++) { await Task.Delay(250).ConfigureAwait(false); wsUrl = TryDebuggerUrl(); }
                if (wsUrl == null) throw new Exception("Chrome không cho gắn vào (hết thời gian chờ). Máy có thể đang chặn tính năng này.");
            }
            ws = new ClientWebSocket();
            await ws.ConnectAsync(new Uri(wsUrl), cts.Token).ConfigureAwait(false);
            Status("Đã nối với Chrome, đang gắn vào trang HIS...");
            Task recv = ReceiveLoop();
            await Send("Target.setDiscoverTargets", D("discover", true), null, null).ConfigureAwait(false);
            if (reused) await Send("Target.createTarget", D("url", cfgUrl), null, null).ConfigureAwait(false);
            await recv.ConfigureAwait(false);
            if (!closing) Ui(delegate { Close(); });   // Chrome đã đóng thì app cũng tắt
        }

        // ---------- trao đổi với Chrome ----------
        async Task Send(string method, Dictionary<string, object> prm, string sessionId, Action<Dictionary<string, object>> cb)
        {
            int id;
            lock (pending) { id = ++nextId; if (cb != null) pending[id] = cb; }
            var msg = D("id", id, "method", method, "params", prm ?? new Dictionary<string, object>());
            if (sessionId != null) msg["sessionId"] = sessionId;
            byte[] bytes = Encoding.UTF8.GetBytes(ser.Serialize(msg));
            await sendLock.WaitAsync().ConfigureAwait(false);
            try { await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cts.Token).ConfigureAwait(false); }
            finally { sendLock.Release(); }
        }
        void Fire(Task t) { t.ContinueWith(delegate(Task x) { var ignore = x.Exception; }, TaskContinuationOptions.OnlyOnFaulted); }

        async Task ReceiveLoop()
        {
            var buf = new byte[1 << 16];
            var ms = new MemoryStream();
            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    WebSocketReceiveResult r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), cts.Token).ConfigureAwait(false);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    ms.Write(buf, 0, r.Count);
                    if (!r.EndOfMessage) continue;
                    string text = Encoding.UTF8.GetString(ms.ToArray());
                    ms.SetLength(0);
                    try { OnMessage(ser.Deserialize<Dictionary<string, object>>(text)); }
                    catch (Exception ex) { Log("Lỗi xử lý tin từ Chrome: " + ex.Message); }
                }
            }
            catch (Exception) { }   // Chrome đóng hoặc app đang tắt
        }

        void OnMessage(Dictionary<string, object> msg)
        {
            if (msg.ContainsKey("id"))
            {
                Action<Dictionary<string, object>> cb = null;
                int id = Convert.ToInt32(msg["id"]);
                lock (pending) { if (pending.TryGetValue(id, out cb)) pending.Remove(id); }
                if (cb != null) cb(msg);
                return;
            }
            string method = Str(msg, "method");
            Dictionary<string, object> prm = Obj(msg, "params");
            if (method == "Target.targetCreated")
            {
                Dictionary<string, object> info = Obj(prm, "targetInfo");
                if (Str(info, "type") != "page") return;
                string tid = Str(info, "targetId");
                lock (sessions) { if (sessions.ContainsKey(tid)) return; sessions[tid] = ""; }
                Fire(Send("Target.attachToTarget", D("targetId", tid, "flatten", true), null, delegate(Dictionary<string, object> resp)
                {
                    string sid = Str(Obj(resp, "result"), "sessionId");
                    if (sid == "") { lock (sessions) { sessions.Remove(tid); } return; }
                    int n;
                    lock (sessions) { sessions[tid] = sid; n = sessions.Count; }
                    hadPage = true;
                    // Gắn cho trang hiện tại và cho mọi lần tải trang về sau trong thẻ này
                    Fire(Send("Page.enable", null, sid, null));
                    Fire(Send("Page.addScriptToEvaluateOnNewDocument", D("source", helper), sid, null));
                    Fire(Send("Runtime.evaluate", D("expression", helper), sid, null));
                    Status("Đang chạy trên " + n + " thẻ. Thu nhỏ được, đừng đóng cửa sổ Chrome của app.");
                }));
            }
            else if (method == "Target.targetDestroyed")
            {
                int n;
                lock (sessions) { sessions.Remove(Str(prm, "targetId")); n = sessions.Count; }
                if (hadPage && n == 0 && !closing)
                {
                    Fire(Send("Browser.close", null, null, null));   // không còn thẻ nào: đóng hẳn Chrome của app
                    Ui(delegate { Close(); });
                }
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            closing = true;
            try
            {
                if (ws != null && ws.State == WebSocketState.Open)
                {
                    string[] sids;
                    lock (sessions) { sids = new List<string>(sessions.Values).ToArray(); }
                    // Tháo nút và bảng của app khỏi các trang đang mở; trang tải lại sau đó sẽ không còn app
                    foreach (string s in sids) if (s != "") Send("Runtime.evaluate", D("expression", "window.__xepgioRemove&&window.__xepgioRemove()"), s, null).Wait(500);
                    ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None).Wait(500);
                }
            }
            catch { }
            cts.Cancel();
            base.OnFormClosing(e);
        }
    }
}
