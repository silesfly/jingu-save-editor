using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

namespace JinGuSaveEditor
{
    public class SaveInfo
    {
        public string Path;
        public string Name;
        public string Label;
        public string Slot;
        public string Kind;
        public DateTime Modified;
        public long SizeBytes;
    }

    public static class SaveStore
    {
        public const long MaxSaveBytes = 32L * 1024L * 1024L;

        private static readonly byte[] SaveSalt = new byte[]
        {
            0x02, 0x23, 0x7e, 0x7a, 0x9c, 0x7d, 0x62, 0x96
        };

        private const string SavePassword = "MyPassword";
        private const int Pbkdf2Iterations = 1000;
        private const string CompanyFolder = "\u91d1\u5341\u56db\u5de5\u4f5c\u5ba4";

        private static readonly string[] DosReservedNames = new string[]
        {
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
        };

        private sealed class SafeTransactionHandle : SafeHandleZeroOrMinusOneIsInvalid
        {
            private SafeTransactionHandle()
                : base(true)
            {
            }

            protected override bool ReleaseHandle()
            {
                return NativeMethods.CloseHandle(handle);
            }
        }

        private static class NativeMethods
        {
            internal const uint GENERIC_READ = 0x80000000;
            internal const uint GENERIC_WRITE = 0x40000000;
            internal const uint CREATE_NEW = 1;
            internal const uint OPEN_EXISTING = 3;
            internal const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
            internal const uint FILE_FLAG_WRITE_THROUGH = 0x80000000;
            internal const uint MOVEFILE_REPLACE_EXISTING = 0x00000001;
            internal const uint MOVEFILE_WRITE_THROUGH = 0x00000008;

            [StructLayout(LayoutKind.Sequential)]
            internal struct BY_HANDLE_FILE_INFORMATION
            {
                public uint FileAttributes;
                public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
                public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
                public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
                public uint VolumeSerialNumber;
                public uint FileSizeHigh;
                public uint FileSizeLow;
                public uint NumberOfLinks;
                public uint FileIndexHigh;
                public uint FileIndexLow;
            }

            [DllImport("kernel32.dll", SetLastError = true)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static extern bool CloseHandle(IntPtr hObject);

            [DllImport("kernel32.dll", SetLastError = true)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static extern bool GetFileInformationByHandle(
                SafeFileHandle hFile,
                out BY_HANDLE_FILE_INFORMATION lpFileInformation);

            [DllImport("ktmw32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
            internal static extern SafeTransactionHandle CreateTransaction(
                IntPtr lpTransactionAttributes,
                IntPtr uow,
                int createOptions,
                int isolationLevel,
                int isolationFlags,
                int timeout,
                [MarshalAs(UnmanagedType.LPWStr)] string description);

            [DllImport("ktmw32.dll", SetLastError = true)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static extern bool CommitTransaction(SafeTransactionHandle transactionHandle);

            [DllImport("ktmw32.dll", SetLastError = true)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static extern bool RollbackTransaction(SafeTransactionHandle transactionHandle);

            [DllImport("kernel32.dll", EntryPoint = "CreateFileTransactedW", SetLastError = true, CharSet = CharSet.Unicode)]
            internal static extern SafeFileHandle CreateFileTransacted(
                string lpFileName,
                uint dwDesiredAccess,
                uint dwShareMode,
                IntPtr lpSecurityAttributes,
                uint dwCreationDisposition,
                uint dwFlagsAndAttributes,
                IntPtr hTemplateFile,
                SafeTransactionHandle hTransaction,
                IntPtr pusMiniVersion,
                IntPtr lpExtendedParameter);

            [DllImport("kernel32.dll", EntryPoint = "MoveFileTransactedW", SetLastError = true, CharSet = CharSet.Unicode)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static extern bool MoveFileTransacted(
                string lpExistingFileName,
                string lpNewFileName,
                IntPtr lpProgressRoutine,
                IntPtr lpData,
                uint dwFlags,
                SafeTransactionHandle hTransaction);

            [DllImport("kernel32.dll", EntryPoint = "DeleteFileTransactedW", SetLastError = true, CharSet = CharSet.Unicode)]
            [return: MarshalAs(UnmanagedType.Bool)]
            internal static extern bool DeleteFileTransacted(
                string lpFileName,
                SafeTransactionHandle hTransaction);
        }

        public static string Hash(byte[] data)
        {
            if (data == null)
            {
                throw new ArgumentNullException("data");
            }

            using (SHA256 sha = SHA256.Create())
            {
                byte[] digest = sha.ComputeHash(data);
                StringBuilder sb = new StringBuilder(digest.Length * 2);
                for (int i = 0; i < digest.Length; i++)
                {
                    sb.Append(digest[i].ToString("x2", CultureInfo.InvariantCulture));
                }
                return sb.ToString();
            }
        }

        public static void NoLinks(string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                throw new ArgumentException("파일 경로가 비어 있습니다.", "path");
            }

            char[] invalidPathChars = Path.GetInvalidPathChars();
            if (path.IndexOfAny(invalidPathChars) >= 0)
            {
                throw new IOException("경로에 사용할 수 없는 문자가 포함되어 있습니다.");
            }

            if (path.StartsWith("\\\\", StringComparison.Ordinal) ||
                path.StartsWith("//", StringComparison.Ordinal))
            {
                throw new UnauthorizedAccessException("UNC 또는 장치 경로는 허용되지 않습니다.");
            }

            int firstColon = path.IndexOf(':');
            if (firstColon >= 0)
            {
                bool validDriveColon = firstColon == 1 &&
                    ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z'));
                if (!validDriveColon || path.IndexOf(':', firstColon + 1) >= 0)
                {
                    throw new UnauthorizedAccessException("대체 데이터 스트림(ADS) 또는 잘못된 콜론이 포함된 경로는 허용되지 않습니다.");
                }
            }

            string fullPath = Path.GetFullPath(path);
            if (fullPath.StartsWith("\\\\", StringComparison.Ordinal))
            {
                throw new UnauthorizedAccessException("UNC 또는 장치 경로는 허용되지 않습니다.");
            }

            int fullColon = fullPath.IndexOf(':');
            if (fullColon > 1 || (fullColon == 1 && fullPath.IndexOf(':', 2) >= 0))
            {
                throw new UnauthorizedAccessException("대체 데이터 스트림(ADS)이 포함된 경로는 허용되지 않습니다.");
            }

            ValidatePathSegments(fullPath);
            ValidateAncestorsNoReparsePoint(fullPath);

            if (File.Exists(fullPath))
            {
                using (FileStream fs = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    NativeMethods.BY_HANDLE_FILE_INFORMATION info;
                    if (!NativeMethods.GetFileInformationByHandle(fs.SafeFileHandle, out info))
                    {
                        int err = Marshal.GetLastWin32Error();
                        throw new IOException("파일 정보를 확인할 수 없습니다.", new Win32Exception(err));
                    }

                    if ((info.FileAttributes & (uint)FileAttributes.ReparsePoint) != 0)
                    {
                        throw new UnauthorizedAccessException("심볼릭 링크 또는 리파스 포인트 파일은 허용되지 않습니다: " + fullPath);
                    }

                    if (info.NumberOfLinks != 1)
                    {
                        throw new UnauthorizedAccessException("하드 링크가 여러 개인 파일은 허용되지 않습니다: " + fullPath);
                    }
                }
            }
        }

        private static void ValidatePathSegments(string fullPath)
        {
            string root = Path.GetPathRoot(fullPath);
            string relative = fullPath;
            if (!string.IsNullOrEmpty(root) && fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            {
                relative = fullPath.Substring(root.Length);
            }

            string[] segments = relative.Split(new char[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
            char[] invalidFileChars = Path.GetInvalidFileNameChars();

            for (int i = 0; i < segments.Length; i++)
            {
                string seg = segments[i];
                if (seg.IndexOfAny(invalidFileChars) >= 0)
                {
                    throw new IOException("경로 구성 요소에 잘못된 문자가 포함되어 있습니다: " + seg);
                }

                string trimmed = seg.TrimEnd(' ', '.');
                int dotIndex = trimmed.IndexOf('.');
                string baseName = dotIndex >= 0 ? trimmed.Substring(0, dotIndex) : trimmed;

                for (int r = 0; r < DosReservedNames.Length; r++)
                {
                    if (string.Equals(baseName, DosReservedNames[r], StringComparison.OrdinalIgnoreCase))
                    {
                        throw new IOException("예약된 장치 이름은 경로에 사용할 수 없습니다: " + seg);
                    }
                }
            }
        }

        private static void ValidateAncestorsNoReparsePoint(string fullPath)
        {
            string root = Path.GetPathRoot(fullPath);
            string current = fullPath;

            while (!string.IsNullOrEmpty(current))
            {
                if (File.Exists(current) || Directory.Exists(current))
                {
                    FileAttributes attrs = File.GetAttributes(current);
                    if ((attrs & FileAttributes.ReparsePoint) != 0)
                    {
                        throw new UnauthorizedAccessException("심볼릭 링크 또는 정션 경로는 허용되지 않습니다: " + current);
                    }
                }

                if (!string.IsNullOrEmpty(root) &&
                    string.Equals(current.TrimEnd('\\', '/'), root.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }

                string parent = Path.GetDirectoryName(current);
                if (string.IsNullOrEmpty(parent) || string.Equals(parent, current, StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }
                current = parent;
            }
        }

        public static byte[] Read(string path)
        {
            NoLinks(path);
            string fullPath = Path.GetFullPath(path);

            if (!string.Equals(Path.GetExtension(fullPath), ".bytes", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("세이브 파일은 .bytes 확장자여야 합니다.");
            }

            if (!File.Exists(fullPath))
            {
                throw new FileNotFoundException("세이브 파일을 찾을 수 없습니다.", fullPath);
            }

            FileInfo fi = new FileInfo(fullPath);
            if (fi.Length <= 0 || fi.Length > MaxSaveBytes)
            {
                throw new InvalidDataException("세이브 파일 크기가 허용 범위(1바이트~32MB)를 벗어났습니다.");
            }

            using (FileStream fs = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                if (fs.Length > MaxSaveBytes)
                {
                    throw new InvalidDataException("세이브 파일 크기가 최대 허용 크기(32MB)를 초과했습니다.");
                }

                int length = (int)fs.Length;
                byte[] buffer = new byte[length];
                int offset = 0;
                while (offset < length)
                {
                    int read = fs.Read(buffer, offset, length - offset);
                    if (read == 0)
                    {
                        throw new EndOfStreamException("세이브 파일을 끝까지 읽지 못했습니다.");
                    }
                    offset += read;
                }
                return buffer;
            }
        }

        public static void ValidateSaveBytes(byte[] data)
        {
            if (data == null || data.Length == 0)
            {
                throw new InvalidDataException("세이브 데이터가 비어 있습니다.");
            }

            if (data.Length > MaxSaveBytes)
            {
                throw new InvalidDataException("세이브 데이터 크기가 최대 허용 크기(32MB)를 초과했습니다.");
            }

            if (data.Length % 16 != 0)
            {
                throw new InvalidDataException("암호화된 세이브 데이터 길이가 16바이트 배수가 아닙니다.");
            }

            byte[] plainBytes;
            try
            {
                using (Rfc2898DeriveBytes kdf = new Rfc2898DeriveBytes(SavePassword, SaveSalt, Pbkdf2Iterations))
                {
                    byte[] dk = kdf.GetBytes(48);
                    byte[] key = new byte[32];
                    byte[] iv = new byte[16];
                    Buffer.BlockCopy(dk, 0, key, 0, 32);
                    Buffer.BlockCopy(dk, 32, iv, 0, 16);

                    using (Aes aes = Aes.Create())
                    {
                        if (aes == null)
                        {
                            throw new InvalidDataException("AES 암호화 공급자를 초기화할 수 없습니다.");
                        }

                        aes.KeySize = 256;
                        aes.BlockSize = 128;
                        aes.Mode = CipherMode.CBC;
                        aes.Padding = PaddingMode.PKCS7;
                        aes.Key = key;
                        aes.IV = iv;

                        using (ICryptoTransform decryptor = aes.CreateDecryptor())
                        using (MemoryStream ms = new MemoryStream())
                        {
                            using (CryptoStream cs = new CryptoStream(ms, decryptor, CryptoStreamMode.Write))
                            {
                                cs.Write(data, 0, data.Length);
                                cs.FlushFinalBlock();
                            }
                            plainBytes = ms.ToArray();
                        }
                    }
                }
            }
            catch (CryptographicException ex)
            {
                throw new InvalidDataException("세이브 데이터 복호화에 실패했습니다.", ex);
            }

            string json;
            try
            {
                UTF8Encoding strictUtf8 = new UTF8Encoding(false, true);
                json = strictUtf8.GetString(plainBytes);
            }
            catch (DecoderFallbackException ex)
            {
                throw new InvalidDataException("복호화된 세이브 데이터가 올바른 UTF-8 문자열이 아닙니다.", ex);
            }

            if (json.Length > 0 && json[0] == '\uFEFF')
            {
                json = json.Substring(1);
            }

            string trimmed = json.Trim();
            if (trimmed.Length < 2 || trimmed[0] != '{' || trimmed[trimmed.Length - 1] != '}')
            {
                throw new InvalidDataException("세이브 데이터가 올바른 JSON 객체 형식이 아닙니다.");
            }

            Dictionary<string, object> parsed;
            try
            {
                JavaScriptSerializer serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = Math.Max(trimmed.Length, 4 * 1024 * 1024);
                parsed = serializer.DeserializeObject(trimmed) as Dictionary<string, object>;
            }
            catch (ArgumentException ex)
            {
                throw new InvalidDataException("세이브 데이터가 올바른 JSON 객체 형식이 아닙니다.", ex);
            }

            if (parsed == null)
            {
                throw new InvalidDataException("세이브 데이터가 올바른 JSON 객체 형식이 아닙니다.");
            }

            bool isSaveData =
                parsed.ContainsKey("m_equips") &&
                parsed.ContainsKey("m_itemDic") &&
                parsed.ContainsKey("m_effectDic");

            bool isGlobalData =
                parsed.ContainsKey("m_guideHash") &&
                parsed.ContainsKey("m_achieveHash");

            if (!isSaveData && !isGlobalData)
            {
                throw new InvalidDataException("인식할 수 없는 세이브 데이터 구조입니다.");
            }
        }

        public static bool IsGameRunning()
        {
            if (string.Equals(Environment.GetEnvironmentVariable("JGSE_SIMULATE_GAME_RUNNING"), "1", StringComparison.Ordinal))
            {
                return true;
            }

            Process[] processes = Process.GetProcessesByName("JinGu");
            bool running = processes.Length > 0;
            for (int i = 0; i < processes.Length; i++)
            {
                processes[i].Dispose();
            }
            return running;
        }

        public static List<SaveInfo> DiscoverSaves()
        {
            List<SaveInfo> results = new List<SaveInfo>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (!string.IsNullOrEmpty(userProfile))
            {
                string localLowRoot = Path.Combine(
                    userProfile,
                    "AppData",
                    "LocalLow",
                    CompanyFolder,
                    "JinGu",
                    "SaveDatas");

                ScanDirectorySafe(localLowRoot, 0, 3, false, results, seen);
            }

            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            if (!string.IsNullOrEmpty(pf86))
            {
                string steamUserData = Path.Combine(pf86, "Steam", "userdata");
                if (Directory.Exists(steamUserData) && !IsReparsePoint(steamUserData))
                {
                    try
                    {
                        string[] userDirs = Directory.GetDirectories(steamUserData);
                        for (int i = 0; i < userDirs.Length; i++)
                        {
                            string userDir = userDirs[i];
                            if (IsReparsePoint(userDir))
                            {
                                continue;
                            }

                            string remoteDir = Path.Combine(userDir, "3313720", "remote");
                            ScanDirectorySafe(remoteDir, 0, 2, true, results, seen);
                        }
                    }
                    catch (IOException)
                    {
                    }
                    catch (UnauthorizedAccessException)
                    {
                    }
                }
            }

            results.Sort(CompareSaveInfoDescending);
            return results;
        }

        private static int CompareSaveInfoDescending(SaveInfo a, SaveInfo b)
        {
            return DateTime.Compare(b.Modified, a.Modified);
        }

        private static bool IsReparsePoint(string path)
        {
            try
            {
                FileAttributes attrs = File.GetAttributes(path);
                return (attrs & FileAttributes.ReparsePoint) != 0;
            }
            catch
            {
                return true;
            }
        }

        private static void ScanDirectorySafe(
            string directory,
            int depth,
            int maxDepth,
            bool isSteamCloud,
            List<SaveInfo> results,
            HashSet<string> seen)
        {
            if (depth > maxDepth || string.IsNullOrEmpty(directory) || !Directory.Exists(directory))
            {
                return;
            }

            if (IsReparsePoint(directory))
            {
                return;
            }

            try
            {
                string[] files = Directory.GetFiles(directory, "*.bytes", SearchOption.TopDirectoryOnly);
                for (int i = 0; i < files.Length; i++)
                {
                    string filePath = Path.GetFullPath(files[i]);
                    if (seen.Contains(filePath))
                    {
                        continue;
                    }

                    try
                    {
                        NoLinks(filePath);
                        FileInfo fi = new FileInfo(filePath);
                        seen.Add(filePath);
                        results.Add(CreateSaveInfo(fi, isSteamCloud));
                    }
                    catch (IOException)
                    {
                    }
                    catch (UnauthorizedAccessException)
                    {
                    }
                }

                if (depth < maxDepth)
                {
                    string[] subDirs = Directory.GetDirectories(directory);
                    for (int i = 0; i < subDirs.Length; i++)
                    {
                        ScanDirectorySafe(subDirs[i], depth + 1, maxDepth, isSteamCloud, results, seen);
                    }
                }
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        private static SaveInfo CreateSaveInfo(FileInfo fi, bool isSteamCloud)
        {
            string fileName = fi.Name;
            string slot = Path.GetFileNameWithoutExtension(fileName);
            string parentName = fi.Directory != null ? fi.Directory.Name : string.Empty;

            string kind = "SaveData";
            string label;

            if (string.Equals(fileName, "Setting.bytes", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(parentName, "Global", StringComparison.OrdinalIgnoreCase))
            {
                kind = "GlobalData";
                label = "전역 설정";
            }
            else if (isSteamCloud)
            {
                label = "Steam 클라우드";
            }
            else if (string.Equals(parentName, "AutoSave", StringComparison.OrdinalIgnoreCase))
            {
                label = "자동 세이브";
            }
            else if (string.Equals(parentName, "Fixed", StringComparison.OrdinalIgnoreCase))
            {
                label = "고정 세이브";
            }
            else
            {
                label = "수동 세이브";
            }

            SaveInfo info = new SaveInfo();
            info.Path = fi.FullName;
            info.Name = fileName;
            info.Label = label;
            info.Slot = slot;
            info.Kind = kind;
            info.Modified = fi.LastWriteTime;
            info.SizeBytes = fi.Length;
            return info;
        }

        public static string SaveWithBackup(string path, byte[] data, string expectedSha256)
        {
            return SaveWithBackup(path, data, expectedSha256, null, null);
        }

        public static string SaveWithBackup(
            string path,
            byte[] data,
            string expectedSha256,
            Action afterLockHook,
            Action beforeCommitHook)
        {
            if (IsGameRunning())
            {
                throw new InvalidOperationException("게임(JinGu.exe)이 실행 중이므로 세이브 파일을 수정할 수 없습니다. 게임을 종료한 뒤 다시 시도하세요.");
            }

            NoLinks(path);
            ValidateSaveBytes(data);

            string fullPath = Path.GetFullPath(path);
            if (!string.Equals(Path.GetExtension(fullPath), ".bytes", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("세이브 파일은 .bytes 확장자여야 합니다.");
            }

            string directory = Path.GetDirectoryName(fullPath);
            if (string.IsNullOrEmpty(directory))
            {
                throw new IOException("대상 디렉터리를 확인할 수 없습니다.");
            }

            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }
            NoLinks(fullPath);

            string guid8 = Guid.NewGuid().ToString("N").Substring(0, 8);
            string pendingPath = fullPath + ".pending-" + guid8;
            string backupPath = null;
            bool committed = false;

            SafeTransactionHandle tx = NativeMethods.CreateTransaction(
                IntPtr.Zero,
                IntPtr.Zero,
                0,
                0,
                0,
                0,
                "JinGuSaveEditor");

            if (tx == null || tx.IsInvalid)
            {
                int err = Marshal.GetLastWin32Error();
                if (tx != null)
                {
                    tx.Dispose();
                }
                throw new IOException("파일 시스템 트랜잭션을 시작할 수 없습니다.", new Win32Exception(err));
            }

            try
            {
                bool targetInitiallyExisted = File.Exists(fullPath);
                if (targetInitiallyExisted)
                {
                    SafeFileHandle targetHandle = NativeMethods.CreateFileTransacted(
                        fullPath,
                        NativeMethods.GENERIC_READ | NativeMethods.GENERIC_WRITE,
                        0,
                        IntPtr.Zero,
                        NativeMethods.OPEN_EXISTING,
                        NativeMethods.FILE_ATTRIBUTE_NORMAL,
                        IntPtr.Zero,
                        tx,
                        IntPtr.Zero,
                        IntPtr.Zero);

                    if (targetHandle == null || targetHandle.IsInvalid)
                    {
                        int err = Marshal.GetLastWin32Error();
                        if (targetHandle != null)
                        {
                            targetHandle.Dispose();
                        }
                        throw new IOException("대상 파일을 트랜잭션 잠금으로 열 수 없습니다.", new Win32Exception(err));
                    }

                    using (FileStream targetStream = new FileStream(targetHandle, FileAccess.ReadWrite))
                    {
                        byte[] existingBytes = ReadAllFromLockedStream(targetStream);
                        if (!string.IsNullOrEmpty(expectedSha256))
                        {
                            string actualHash = Hash(existingBytes);
                            if (!string.Equals(actualHash, expectedSha256, StringComparison.OrdinalIgnoreCase))
                            {
                                throw new IOException("대상 파일이 외부에서 변경되어 저장을 중단했습니다.");
                            }
                        }

                        if (afterLockHook != null)
                        {
                            afterLockHook();
                        }

                        string timestamp = DateTime.Now.ToString("yyyyMMddHHmmssfff", CultureInfo.InvariantCulture);
                        backupPath = string.Format(CultureInfo.InvariantCulture, "{0}.backup-{1}-{2}.bak", fullPath, timestamp, guid8);
                        using (FileStream backupStream = new FileStream(backupPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        {
                            backupStream.Write(existingBytes, 0, existingBytes.Length);
                            backupStream.Flush(true);
                        }
                    }
                }
                else
                {
                    if (!string.IsNullOrEmpty(expectedSha256))
                    {
                        throw new IOException("대상 파일이 존재하지 않아 해시 검증을 수행할 수 없습니다.");
                    }

                    if (afterLockHook != null)
                    {
                        afterLockHook();
                    }
                }

                SafeFileHandle pendingHandle = NativeMethods.CreateFileTransacted(
                    pendingPath,
                    NativeMethods.GENERIC_WRITE,
                    0,
                    IntPtr.Zero,
                    NativeMethods.CREATE_NEW,
                    NativeMethods.FILE_ATTRIBUTE_NORMAL | NativeMethods.FILE_FLAG_WRITE_THROUGH,
                    IntPtr.Zero,
                    tx,
                    IntPtr.Zero,
                    IntPtr.Zero);

                if (pendingHandle == null || pendingHandle.IsInvalid)
                {
                    int err = Marshal.GetLastWin32Error();
                    if (pendingHandle != null)
                    {
                        pendingHandle.Dispose();
                    }
                    throw new IOException("임시 스테이징 파일을 생성할 수 없습니다.", new Win32Exception(err));
                }

                using (FileStream pendingStream = new FileStream(pendingHandle, FileAccess.Write))
                {
                    pendingStream.Write(data, 0, data.Length);
                    pendingStream.Flush(true);
                }

                if (beforeCommitHook != null)
                {
                    beforeCommitHook();
                }

                uint moveFlags = NativeMethods.MOVEFILE_WRITE_THROUGH;
                if (targetInitiallyExisted)
                {
                    moveFlags |= NativeMethods.MOVEFILE_REPLACE_EXISTING;
                }
                else if (File.Exists(fullPath))
                {
                    throw new IOException("동시에 생성된 대상 파일이 감지되어 저장을 중단했습니다.");
                }

                if (!NativeMethods.MoveFileTransacted(pendingPath, fullPath, IntPtr.Zero, IntPtr.Zero, moveFlags, tx))
                {
                    int err = Marshal.GetLastWin32Error();
                    throw new IOException("트랜잭션 파일 교체에 실패했습니다.", new Win32Exception(err));
                }

                if (!NativeMethods.CommitTransaction(tx))
                {
                    int err = Marshal.GetLastWin32Error();
                    throw new IOException("트랜잭션 커밋에 실패했습니다.", new Win32Exception(err));
                }

                committed = true;
                return backupPath;
            }
            finally
            {
                if (!committed)
                {
                    if (tx != null && !tx.IsInvalid)
                    {
                        try
                        {
                            NativeMethods.RollbackTransaction(tx);
                        }
                        catch
                        {
                        }
                    }

                    TryDeletePendingFile(pendingPath);
                }

                tx.Dispose();
            }
        }

        private static byte[] ReadAllFromLockedStream(FileStream stream)
        {
            if (stream.Length > MaxSaveBytes)
            {
                throw new InvalidDataException("기존 세이브 파일 크기가 최대 허용 크기(32MB)를 초과했습니다.");
            }

            stream.Position = 0;
            int length = (int)stream.Length;
            byte[] buffer = new byte[length];
            int offset = 0;
            while (offset < length)
            {
                int read = stream.Read(buffer, offset, length - offset);
                if (read == 0)
                {
                    throw new EndOfStreamException("기존 세이브 파일을 읽지 못했습니다.");
                }
                offset += read;
            }
            return buffer;
        }

        private static void TryDeletePendingFile(string pendingPath)
        {
            try
            {
                if (File.Exists(pendingPath))
                {
                    File.Delete(pendingPath);
                }
            }
            catch
            {
            }
        }

        public static string SaveAtomic(string path, byte[] data)
        {
            return SaveWithBackup(path, data, null, null, null);
        }

        public static string SaveAtomic(string path, byte[] data, string expectedSha256)
        {
            return SaveWithBackup(path, data, expectedSha256, null, null);
        }
    }
}
