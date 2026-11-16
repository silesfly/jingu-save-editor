using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace JinGuSaveEditor
{
    internal static class Program
    {
        [STAThread]
        internal static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool selfTest = false;
            string receiptPath = "receipt.json";

            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    if (string.Equals(args[i], "--self-test", StringComparison.OrdinalIgnoreCase))
                    {
                        selfTest = true;
                        if (i + 1 < args.Length && !string.IsNullOrEmpty(args[i + 1]) && !args[i + 1].StartsWith("--", StringComparison.Ordinal))
                        {
                            receiptPath = args[i + 1];
                            i++;
                        }
                    }
                }
            }

            AppDomain.CurrentDomain.AssemblyResolve += OnAssemblyResolve;

            try
            {
                if (selfTest)
                {
                    SaveEditorForm testForm = new SaveEditorForm(true, receiptPath);
                    Application.Run(testForm);
                    return testForm.SelfTestExitCode;
                }
                else
                {
                    SaveEditorForm form = new SaveEditorForm(false, null);
                    Application.Run(form);
                    return 0;
                }
            }
            catch (Exception ex)
            {
                string msg = "프로그램 실행 중 오류가 발생했습니다.\n\n" + ex.Message;
                if (selfTest)
                {
                    SaveEditorForm.WriteReceiptSafe(receiptPath, false, 0, 0, -1, false, string.Empty, ex.Message);
                    return 1;
                }
                MessageBox.Show(msg, "금고군협전 세이브 에디터", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        private static Assembly OnAssemblyResolve(object sender, ResolveEventArgs args)
        {
            try
            {
                string asmName = new AssemblyName(args.Name).Name;
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string candidate = Path.Combine(baseDir, asmName + ".dll");
                if (File.Exists(candidate))
                {
                    return Assembly.LoadFrom(candidate);
                }
            }
            catch
            {
            }
            return null;
        }
    }

    public class SaveEditorForm : Form
    {
        internal WebView2 webView;
        private readonly bool selfTestMode;
        private readonly string receiptPath;
        private bool selfTestStarted;

        public int SelfTestExitCode { get; private set; }

        public SaveEditorForm()
            : this(false, null)
        {
        }

        public SaveEditorForm(bool isSelfTest, string selfTestReceiptPath)
        {
            this.selfTestMode = isSelfTest;
            this.receiptPath = string.IsNullOrEmpty(selfTestReceiptPath) ? "receipt.json" : selfTestReceiptPath;
            this.SelfTestExitCode = 1;

            this.Text = "금고군협전 세이브 에디터 v1.0";
            this.Size = new Size(1360, 880);
            this.MinimumSize = new Size(1024, 700);
            this.StartPosition = FormStartPosition.CenterScreen;

            if (this.selfTestMode)
            {
                this.ShowInTaskbar = false;
                this.FormBorderStyle = FormBorderStyle.FixedToolWindow;
                this.StartPosition = FormStartPosition.Manual;
                this.Location = new Point(-32000, -32000);
                this.Opacity = 0;
            }

            this.webView = new WebView2();
            this.webView.Dock = DockStyle.Fill;
            this.Controls.Add(this.webView);

            this.Load += OnFormLoad;
        }

        private async void OnFormLoad(object sender, EventArgs e)
        {
            try
            {
                string userDataFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "JinGuSaveEditor",
                    "WebView2");

                Directory.CreateDirectory(userDataFolder);

                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userDataFolder, null);
                await this.webView.EnsureCoreWebView2Async(env);

                CoreWebView2 core = this.webView.CoreWebView2;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.Settings.AreDevToolsEnabled = false;
                core.Settings.AreHostObjectsAllowed = false;

                core.AddWebResourceRequestedFilter("https://jingu.local/*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += OnWebResourceRequested;
                core.NavigationStarting += OnNavigationStarting;
                core.NewWindowRequested += OnNewWindowRequested;
                core.WebMessageReceived += OnWebMessageReceived;
                core.NavigationCompleted += OnNavigationCompleted;

                core.Navigate("https://jingu.local/index.html");
            }
            catch (WebView2RuntimeNotFoundException)
            {
                string errMsg = "Microsoft Edge WebView2 런타임이 설치되어 있지 않습니다.\nWebView2 런타임을 설치한 후 다시 실행해 주세요.";
                HandleInitFailure(errMsg);
            }
            catch (DllNotFoundException ex)
            {
                string errMsg = "WebView2Loader.dll 또는 필수 라이브러리를 찾을 수 없습니다.\n" + ex.Message;
                HandleInitFailure(errMsg);
            }
            catch (Exception ex)
            {
                string errMsg = "WebView2 초기화 중 오류가 발생했습니다.\n" + ex.Message;
                HandleInitFailure(errMsg);
            }
        }

        private void HandleInitFailure(string errMsg)
        {
            if (this.selfTestMode)
            {
                WriteReceiptSafe(this.receiptPath, false, 0, 0, -1, false, string.Empty, errMsg);
                this.SelfTestExitCode = 1;
                this.Close();
            }
            else
            {
                MessageBox.Show(errMsg, "금고군협전 세이브 에디터", MessageBoxButtons.OK, MessageBoxIcon.Error);
                this.Close();
            }
        }

        private void OnWebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            if (e.Request == null || string.IsNullOrEmpty(e.Request.Uri))
            {
                return;
            }
            if (string.Equals(e.Request.Uri, "https://jingu.local/index.html", StringComparison.OrdinalIgnoreCase))
            {
                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream stream = asm.GetManifestResourceStream("JinGuSaveEditor.html"))
                {
                    if (stream == null)
                    {
                        return;
                    }
                    MemoryStream ms = new MemoryStream();
                    stream.CopyTo(ms);
                    ms.Position = 0;
                    CoreWebView2 core = (CoreWebView2)sender;
                    e.Response = core.Environment.CreateWebResourceResponse(
                        ms,
                        200,
                        "OK",
                        "Content-Type: text/html; charset=utf-8");
                }
            }
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            string uri = e.Uri ?? string.Empty;
            if (string.Equals(uri, "https://jingu.local/index.html", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(uri, "about:blank", StringComparison.OrdinalIgnoreCase) ||
                uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
            {
                return;
            }
            e.Cancel = true;
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string rawJson = e.WebMessageAsJson;
            if (!string.IsNullOrEmpty(rawJson) && rawJson.StartsWith("\"", StringComparison.Ordinal))
            {
                JavaScriptSerializer serializer = CreateSerializer();
                rawJson = serializer.Deserialize<string>(rawJson);
            }
            DispatchWebMessage(this, rawJson, null);
        }

        private async void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!this.selfTestMode || this.selfTestStarted)
            {
                return;
            }
            this.selfTestStarted = true;

            if (!e.IsSuccess)
            {
                WriteReceiptSafe(
                    this.receiptPath,
                    false,
                    0,
                    0,
                    -1,
                    false,
                    GetWebView2VersionSafe(),
                    "HTML 내비게이션 실패: " + e.WebErrorStatus.ToString());
                this.SelfTestExitCode = 1;
                this.Close();
                return;
            }

            await RunSelfTestAsync();
        }

        private string GetWebView2VersionSafe()
        {
            try
            {
                if (this.webView != null && this.webView.CoreWebView2 != null && this.webView.CoreWebView2.Environment != null)
                {
                    return this.webView.CoreWebView2.Environment.BrowserVersionString;
                }
            }
            catch
            {
            }
            return string.Empty;
        }

        private async Task RunSelfTestAsync()
        {
            long money = 0;
            int wuxueCount = 0;
            int hanziCount = -1;
            bool validateOk = false;
            string version = GetWebView2VersionSafe();

            try
            {
                JavaScriptSerializer serializer = CreateSerializer();

                string checkScript =
                    "(function() {" +
                    "  var hasCat = (typeof window.JinGuCatalog === 'object' && window.JinGuCatalog !== null && Array.isArray(window.JinGuCatalog.wuxue) && window.JinGuCatalog.wuxue.length > 0);" +
                    "  var hasCore = (typeof window.JinGuEditorCore === 'object' && window.JinGuEditorCore !== null);" +
                    "  var tabCount = document.querySelectorAll('#save-tablist [role=\"tab\"]').length;" +
                    "  var text = document.body ? (document.body.innerText || '') : '';" +
                    "  var hanziMatches = text.match(/[\\u4E00-\\u9FFF]/g);" +
                    "  return {" +
                    "    hasCat: hasCat," +
                    "    hasCore: hasCore," +
                    "    wuxueCount: hasCat ? window.JinGuCatalog.wuxue.length : 0," +
                    "    tabCount: tabCount," +
                    "    hanziCount: hanziMatches ? hanziMatches.length : 0" +
                    "  };" +
                    "})()";

                string checkJson = await this.webView.CoreWebView2.ExecuteScriptAsync(checkScript);
                Dictionary<string, object> checkObj = serializer.Deserialize<Dictionary<string, object>>(checkJson);

                if (checkObj == null)
                {
                    throw new InvalidOperationException("셀프테스트 초기 DOM 검사 결과가 비어 있습니다.");
                }

                bool hasCat = GetBool(checkObj, "hasCat");
                bool hasCore = GetBool(checkObj, "hasCore");
                wuxueCount = GetInt(checkObj, "wuxueCount");
                int tabCount = GetInt(checkObj, "tabCount");
                hanziCount = GetInt(checkObj, "hanziCount");

                if (!hasCat || wuxueCount <= 0)
                {
                    throw new InvalidOperationException("JinGuCatalog.wuxue가 비어 있거나 로드되지 않았습니다.");
                }
                if (!hasCore)
                {
                    throw new InvalidOperationException("JinGuEditorCore가 로드되지 않았습니다.");
                }
                if (tabCount < 6)
                {
                    throw new InvalidOperationException("탭 개수가 6개 미만입니다: " + tabCount);
                }
                if (hanziCount != 0)
                {
                    throw new InvalidOperationException("화면 텍스트에 한자가 포함되어 있습니다: " + hanziCount);
                }

                string saveScript =
                    "(function() {" +
                    "  var b = window.JinGuEditorCore.buildDemoSaveBytes(window.JinGuCatalog);" +
                    "  var sess = window.JinGuEditorCore.createSession(window.JinGuCatalog);" +
                    "  sess.loadBytes(b, 'selftest.bytes');" +
                    "  sess.applyPreset('money_rich');" +
                    "  var out = sess.saveBytes();" +
                    "  var sess2 = window.JinGuEditorCore.createSession(window.JinGuCatalog);" +
                    "  sess2.loadBytes(out, 'selftest2.bytes');" +
                    "  var bin = '';" +
                    "  for (var i = 0; i < out.length; i++) { bin += String.fromCharCode(out[i]); }" +
                    "  return { b64: btoa(bin), money: sess2.getMoney() };" +
                    "})()";

                string saveJson = await this.webView.CoreWebView2.ExecuteScriptAsync(saveScript);
                Dictionary<string, object> saveObj = serializer.Deserialize<Dictionary<string, object>>(saveJson);
                if (saveObj == null)
                {
                    throw new InvalidOperationException("SaveData 데모 생성 결과가 비어 있습니다.");
                }

                money = GetLong(saveObj, "money");
                string saveB64 = GetString(saveObj, "b64");
                if (money != 100000000L)
                {
                    throw new InvalidOperationException("money_rich 프리셋 검증 실패: " + money);
                }
                if (string.IsNullOrEmpty(saveB64))
                {
                    throw new InvalidOperationException("SaveData 직렬화 바이트가 비어 있습니다.");
                }

                byte[] saveBytes = Convert.FromBase64String(saveB64);
                SaveStore.ValidateSaveBytes(saveBytes);

                string globalScript =
                    "(function() {" +
                    "  var g = window.JinGuEditorCore.buildDemoGlobalBytes(window.JinGuCatalog);" +
                    "  var sess = window.JinGuEditorCore.createSession(window.JinGuCatalog);" +
                    "  sess.loadBytes(g, 'GlobalData.bytes');" +
                    "  var out = sess.saveBytes();" +
                    "  var bin = '';" +
                    "  for (var i = 0; i < out.length; i++) { bin += String.fromCharCode(out[i]); }" +
                    "  return { b64: btoa(bin) };" +
                    "})()";

                string globalJson = await this.webView.CoreWebView2.ExecuteScriptAsync(globalScript);
                Dictionary<string, object> globalObj = serializer.Deserialize<Dictionary<string, object>>(globalJson);
                string globalB64 = globalObj != null ? GetString(globalObj, "b64") : null;
                if (string.IsNullOrEmpty(globalB64))
                {
                    throw new InvalidOperationException("GlobalData 직렬화 바이트가 비어 있습니다.");
                }

                byte[] globalBytes = Convert.FromBase64String(globalB64);
                SaveStore.ValidateSaveBytes(globalBytes);

                validateOk = true;

                string discoverResp = DispatchWebMessage(null, "{\"cmd\":\"discover\"}", null);
                Dictionary<string, object> discoverObj = serializer.Deserialize<Dictionary<string, object>>(discoverResp);
                if (discoverObj == null || !GetBool(discoverObj, "ok"))
                {
                    throw new InvalidOperationException("discover 메시지 처리 검증 실패");
                }

                string saveAsGuardReq = serializer.Serialize(new Dictionary<string, object>
                {
                    { "cmd", "saveAs" },
                    { "path", "should_not_overwrite.bytes" },
                    { "dataB64", saveB64 }
                });
                string saveAsResp = DispatchWebMessage(null, saveAsGuardReq, null);
                Dictionary<string, object> saveAsObj = serializer.Deserialize<Dictionary<string, object>>(saveAsResp);
                if (saveAsObj == null || GetBool(saveAsObj, "ok"))
                {
                    throw new InvalidOperationException("saveAs 경로 보호 검증 실패");
                }

                WriteReceiptSafe(this.receiptPath, true, money, wuxueCount, hanziCount, validateOk, version, string.Empty);
                this.SelfTestExitCode = 0;
            }
            catch (Exception ex)
            {
                WriteReceiptSafe(this.receiptPath, false, money, wuxueCount, hanziCount, validateOk, version, ex.Message);
                this.SelfTestExitCode = 1;
            }
            finally
            {
                this.Close();
            }
        }

        internal static void WriteReceiptSafe(
            string path,
            bool ok,
            long money,
            int wuxueCount,
            int hanziCount,
            bool validateOk,
            string webView2Version,
            string error)
        {
            try
            {
                string dir = Path.GetDirectoryName(Path.GetFullPath(path));
                if (!string.IsNullOrEmpty(dir))
                {
                    Directory.CreateDirectory(dir);
                }

                Dictionary<string, object> receipt = new Dictionary<string, object>();
                receipt["ok"] = ok;
                receipt["money"] = money;
                receipt["wuxueCount"] = wuxueCount;
                receipt["hanziCount"] = hanziCount;
                receipt["validateOk"] = validateOk;
                receipt["webView2Version"] = webView2Version ?? string.Empty;
                receipt["error"] = error ?? string.Empty;

                JavaScriptSerializer serializer = CreateSerializer();
                string json = serializer.Serialize(receipt);
                File.WriteAllText(path, json, new UTF8Encoding(false));
            }
            catch
            {
            }
        }

        public static string DispatchWebMessage(SaveEditorForm form, string jsonText, Func<string, string> saveDialogOverride)
        {
            JavaScriptSerializer serializer = CreateSerializer();
            string cmd = string.Empty;
            string resultCmd = "errorResult";

            try
            {
                Dictionary<string, object> req = serializer.Deserialize<Dictionary<string, object>>(jsonText ?? "{}");
                if (req == null)
                {
                    req = new Dictionary<string, object>();
                }

                cmd = GetString(req, "cmd") ?? string.Empty;
                resultCmd = cmd + "Result";

                Dictionary<string, object> res = new Dictionary<string, object>();

                if (string.Equals(cmd, "discover", StringComparison.Ordinal))
                {
                    var discovered = SaveStore.DiscoverSaves();
                    List<Dictionary<string, object>> files = new List<Dictionary<string, object>>();
                    if (discovered != null)
                    {
                        foreach (var item in discovered)
                        {
                            Dictionary<string, object> entry = new Dictionary<string, object>();
                            entry["path"] = item.Path;
                            entry["name"] = item.Name;
                            entry["label"] = item.Label;
                            entry["slot"] = item.Slot;
                            entry["kind"] = item.Kind;
                            entry["modified"] = item.Modified.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                            entry["size"] = item.SizeBytes;
                            files.Add(entry);
                        }
                    }

                    res["ok"] = true;
                    res["cmd"] = "discoverResult";
                    res["files"] = files;
                }
                else if (string.Equals(cmd, "open", StringComparison.Ordinal))
                {
                    string path = GetString(req, "path");
                    if (string.IsNullOrEmpty(path))
                    {
                        if (form != null)
                        {
                            using (OpenFileDialog dlg = new OpenFileDialog())
                            {
                                dlg.Title = "세이브 파일 열기";
                                dlg.Filter = "금고군협전 세이브 (*.bytes)|*.bytes";
                                string initDir = FindInitialSaveDirectory();
                                if (!string.IsNullOrEmpty(initDir))
                                {
                                    dlg.InitialDirectory = initDir;
                                }
                                if (dlg.ShowDialog(form) != DialogResult.OK)
                                {
                                    res["ok"] = false;
                                    res["cmd"] = "openResult";
                                    res["cancelled"] = true;
                                    res["error"] = "파일 선택이 취소되었습니다.";
                                    return PostAndReturn(form, serializer, res);
                                }
                                path = dlg.FileName;
                            }
                        }
                        else
                        {
                            throw new InvalidOperationException("열 파일 경로가 지정되지 않았습니다.");
                        }
                    }

                    string fullPath = Path.GetFullPath(path);
                    byte[] bytes = SaveStore.Read(fullPath);
                    SaveStore.ValidateSaveBytes(bytes);

                    res["ok"] = true;
                    res["cmd"] = "openResult";
                    res["path"] = fullPath;
                    res["name"] = Path.GetFileName(fullPath);
                    res["sha256"] = SaveStore.Hash(bytes);
                    res["dataB64"] = Convert.ToBase64String(bytes);
                }
                else if (string.Equals(cmd, "save", StringComparison.Ordinal))
                {
                    string path = GetString(req, "path");
                    string dataB64 = GetString(req, "dataB64");
                    string expectedHash = GetString(req, "expectedHash");

                    if (string.IsNullOrEmpty(path))
                    {
                        throw new InvalidOperationException("저장할 파일 경로가 비어 있습니다.");
                    }
                    if (string.IsNullOrEmpty(dataB64))
                    {
                        throw new InvalidOperationException("저장할 세이브 데이터가 비어 있습니다.");
                    }

                    byte[] bytes = Convert.FromBase64String(dataB64);
                    SaveStore.ValidateSaveBytes(bytes);
                    string bak = SaveStore.SaveWithBackup(path, bytes, expectedHash);

                    res["ok"] = true;
                    res["cmd"] = "saveResult";
                    res["path"] = path;
                    res["name"] = Path.GetFileName(path);
                    res["sha256"] = SaveStore.Hash(bytes);
                    res["backupPath"] = bak;
                }
                else if (string.Equals(cmd, "saveAs", StringComparison.Ordinal))
                {
                    string dataB64 = GetString(req, "dataB64");
                    if (string.IsNullOrEmpty(dataB64))
                    {
                        throw new InvalidOperationException("저장할 세이브 데이터가 비어 있습니다.");
                    }

                    byte[] bytes = Convert.FromBase64String(dataB64);
                    SaveStore.ValidateSaveBytes(bytes);

                    if (form == null && saveDialogOverride == null)
                    {
                        res["ok"] = false;
                        res["cmd"] = "saveAsResult";
                        res["error"] = "다른 이름으로 저장할 파일을 선택할 창이 없습니다.";
                        return PostAndReturn(form, serializer, res);
                    }

                    string suggestName = GetString(req, "suggestName");
                    if (string.IsNullOrEmpty(suggestName))
                    {
                        string existingPath = GetString(req, "path");
                        suggestName = !string.IsNullOrEmpty(existingPath)
                            ? Path.GetFileName(existingPath)
                            : "SaveData.bytes";
                    }

                    string chosenPath = null;
                    if (saveDialogOverride != null)
                    {
                        chosenPath = saveDialogOverride(suggestName);
                    }
                    else
                    {
                        using (SaveFileDialog dlg = new SaveFileDialog())
                        {
                            dlg.Title = "다른 이름으로 저장";
                            dlg.Filter = "금고군협전 세이브 (*.bytes)|*.bytes";
                            dlg.FileName = suggestName;
                            string initDir = FindInitialSaveDirectory();
                            if (!string.IsNullOrEmpty(initDir))
                            {
                                dlg.InitialDirectory = initDir;
                            }
                            if (dlg.ShowDialog(form) == DialogResult.OK)
                            {
                                chosenPath = dlg.FileName;
                            }
                        }
                    }

                    if (string.IsNullOrEmpty(chosenPath))
                    {
                        res["ok"] = false;
                        res["cmd"] = "saveAsResult";
                        res["cancelled"] = true;
                        res["error"] = "저장이 취소되었습니다.";
                        return PostAndReturn(form, serializer, res);
                    }

                    string expectedHash = null;
                    string origPath = GetString(req, "path");
                    if (!string.IsNullOrEmpty(origPath) &&
                        string.Equals(Path.GetFullPath(chosenPath), Path.GetFullPath(origPath), StringComparison.OrdinalIgnoreCase))
                    {
                        expectedHash = GetString(req, "expectedHash");
                    }

                    string bak = SaveStore.SaveWithBackup(chosenPath, bytes, expectedHash);

                    res["ok"] = true;
                    res["cmd"] = "saveAsResult";
                    res["path"] = chosenPath;
                    res["name"] = Path.GetFileName(chosenPath);
                    res["sha256"] = SaveStore.Hash(bytes);
                    res["backupPath"] = bak;
                }
                else
                {
                    res["ok"] = false;
                    res["cmd"] = string.IsNullOrEmpty(cmd) ? "errorResult" : resultCmd;
                    res["error"] = "알 수 없는 명령입니다: " + cmd;
                }

                return PostAndReturn(form, serializer, res);
            }
            catch (Exception ex)
            {
                Dictionary<string, object> errRes = new Dictionary<string, object>();
                errRes["ok"] = false;
                errRes["cmd"] = string.IsNullOrEmpty(cmd) ? "errorResult" : resultCmd;
                errRes["error"] = ex.Message;
                return PostAndReturn(form, serializer, errRes);
            }
        }

        private static string PostAndReturn(SaveEditorForm form, JavaScriptSerializer serializer, Dictionary<string, object> payload)
        {
            string json = serializer.Serialize(payload);
            if (form != null && form.webView != null && form.webView.CoreWebView2 != null)
            {
                form.webView.CoreWebView2.PostWebMessageAsJson(json);
            }
            return json;
        }

        private static string FindInitialSaveDirectory()
        {
            try
            {
                var discovered = SaveStore.DiscoverSaves();
                if (discovered != null && discovered.Count > 0 && !string.IsNullOrEmpty(discovered[0].Path))
                {
                    string dir = Path.GetDirectoryName(discovered[0].Path);
                    if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
                    {
                        return dir;
                    }
                }
            }
            catch
            {
            }
            return null;
        }

        private static JavaScriptSerializer CreateSerializer()
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = 64 * 1024 * 1024;
            return serializer;
        }

        private static string GetString(Dictionary<string, object> dict, string key)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val) && val != null)
            {
                return Convert.ToString(val);
            }
            return null;
        }

        private static bool GetBool(Dictionary<string, object> dict, string key)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val) && val != null)
            {
                return Convert.ToBoolean(val);
            }
            return false;
        }

        private static int GetInt(Dictionary<string, object> dict, string key)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val) && val != null)
            {
                return Convert.ToInt32(val);
            }
            return 0;
        }

        private static long GetLong(Dictionary<string, object> dict, string key)
        {
            object val;
            if (dict != null && dict.TryGetValue(key, out val) && val != null)
            {
                return Convert.ToInt64(val);
            }
            return 0L;
        }
    }
}
