using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using JinGuSaveEditor;

namespace JinGuSaveEditor.Tests
{
    public static class SaveStoreTests
    {
        private static readonly byte[] Salt = new byte[]
        {
            0x02, 0x23, 0x7e, 0x7a, 0x9c, 0x7d, 0x62, 0x96
        };

        private const string Password = "MyPassword";
        private const int Pbkdf2Iterations = 1000;

        private static int passed = 0;
        private static int failed = 0;

        public static int Main(string[] args)
        {
            string tempDir = Path.Combine(
                Path.GetTempPath(),
                "JGSE_Tests_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempDir);

            try
            {
                RunTest("1. Valid SaveData .bytes decrypts and passes ValidateSaveBytes", delegate
                {
                    byte[] validSave = BuildMinimalValidSaveBytes(5000);
                    SaveStore.ValidateSaveBytes(validSave);

                    string slotPath = Path.Combine(tempDir, "slot1.bytes");
                    File.WriteAllBytes(slotPath, validSave);
                    byte[] readResult = SaveStore.Read(slotPath);
                    Assert(readResult != null && readResult.Length == validSave.Length, "SaveStore.Read mismatch for valid SaveData.");
                });

                RunTest("2. Valid GlobalData (Setting.bytes) decrypts and passes ValidateSaveBytes", delegate
                {
                    byte[] validGlobal = BuildMinimalValidGlobalBytes();
                    SaveStore.ValidateSaveBytes(validGlobal);

                    string settingPath = Path.Combine(tempDir, "Setting.bytes");
                    File.WriteAllBytes(settingPath, validGlobal);
                    byte[] readResult = SaveStore.Read(settingPath);
                    Assert(readResult != null && readResult.Length == validGlobal.Length, "SaveStore.Read mismatch for valid GlobalData.");
                });

                RunTest("3. Tampered / non-16-aligned / invalid JSON / >32MB data fails ValidateSaveBytes", delegate
                {
                    byte[] validSave = BuildMinimalValidSaveBytes(1234);

                    byte[] tampered = new byte[validSave.Length];
                    Buffer.BlockCopy(validSave, 0, tampered, 0, validSave.Length);
                    tampered[tampered.Length / 2] ^= 0xFF;
                    AssertThrows(delegate { SaveStore.ValidateSaveBytes(tampered); }, "Tampered bytes should fail.");

                    byte[] nonAligned = new byte[] { 1, 2, 3, 4, 5 };
                    AssertThrows(delegate { SaveStore.ValidateSaveBytes(nonAligned); }, "Non-16-aligned bytes should fail.");

                    byte[] invalidJson = EncryptBytes(Encoding.UTF8.GetBytes("{ invalid json :::"));
                    AssertThrows(delegate { SaveStore.ValidateSaveBytes(invalidJson); }, "Invalid JSON should fail.");

                    byte[] oversized = new byte[(32 * 1024 * 1024) + 16];
                    AssertThrows(delegate { SaveStore.ValidateSaveBytes(oversized); }, ">32MB data should fail.");
                });

                RunTest("4. Non-.bytes extension (evil.txt, foo.sav) rejected by Read and SaveWithBackup", delegate
                {
                    byte[] validSave = BuildMinimalValidSaveBytes(100);
                    string evilPath = Path.Combine(tempDir, "evil.txt");
                    string savPath = Path.Combine(tempDir, "foo.sav");
                    File.WriteAllBytes(evilPath, validSave);
                    File.WriteAllBytes(savPath, validSave);

                    AssertThrows(delegate { SaveStore.Read(evilPath); }, "Read should reject .txt");
                    AssertThrows(delegate { SaveStore.Read(savPath); }, "Read should reject .sav");
                    AssertThrows(delegate { SaveStore.SaveWithBackup(evilPath, validSave, null); }, "SaveWithBackup should reject .txt");
                    AssertThrows(delegate { SaveStore.SaveWithBackup(savPath, validSave, null); }, "SaveWithBackup should reject .sav");
                });

                RunTest("5. Alternate Data Stream and DOS reserved names rejected by NoLinks", delegate
                {
                    string adsPath = Path.Combine(tempDir, "slot.bytes:stream");
                    string nulPath = Path.Combine(tempDir, "NUL.bytes");
                    string conPath = Path.Combine(tempDir, "CON.bytes");

                    AssertThrows(delegate { SaveStore.NoLinks(adsPath); }, "NoLinks should reject ADS path.");
                    AssertThrows(delegate { SaveStore.NoLinks(nulPath); }, "NoLinks should reject NUL.bytes.");
                    AssertThrows(delegate { SaveStore.NoLinks(conPath); }, "NoLinks should reject CON.bytes.");
                });

                RunTest("6. Directory symlink (mklink /D) rejected by NoLinks", delegate
                {
                    string realSubDir = Path.Combine(tempDir, "real_sym_target");
                    string symDir = Path.Combine(tempDir, "sym_dir");
                    Directory.CreateDirectory(realSubDir);

                    int exitCode = RunCommand("cmd.exe", "/c mklink /D \"" + symDir + "\" \"" + realSubDir + "\"");
                    if (exitCode == 0 && Directory.Exists(symDir))
                    {
                        string targetInSym = Path.Combine(symDir, "slot.bytes");
                        AssertThrows(delegate { SaveStore.NoLinks(targetInSym); }, "NoLinks should reject directory symlink.");
                    }
                    else
                    {
                        Console.WriteLine("  [INFO] mklink /D skipped (requires elevation or Developer Mode).");
                    }
                });

                RunTest("7. NTFS Junction (mklink /J) rejected by NoLinks", delegate
                {
                    string juncTarget = Path.Combine(tempDir, "real_junc_target");
                    string juncDir = Path.Combine(tempDir, "junc_dir");
                    Directory.CreateDirectory(juncTarget);

                    int exitCode = RunCommand("cmd.exe", "/c mklink /J \"" + juncDir + "\" \"" + juncTarget + "\"");
                    Assert(exitCode == 0 && Directory.Exists(juncDir), "mklink /J failed to create junction.");

                    string targetInJunc = Path.Combine(juncDir, "slot.bytes");
                    AssertThrows(delegate { SaveStore.NoLinks(targetInJunc); }, "NoLinks should reject NTFS junction.");
                });

                RunTest("8. NTFS Hardlink (fsutil hardlink create) rejected on Read/SaveWithBackup", delegate
                {
                    byte[] validSave = BuildMinimalValidSaveBytes(700);
                    string hlSource = Path.Combine(tempDir, "hl_source.bytes");
                    string hlLink = Path.Combine(tempDir, "hl_link.bytes");
                    File.WriteAllBytes(hlSource, validSave);

                    int exitCode = RunCommand("fsutil.exe", "hardlink create \"" + hlLink + "\" \"" + hlSource + "\"");
                    Assert(exitCode == 0 && File.Exists(hlLink), "fsutil hardlink create failed.");

                    string hlHash = ComputeSha256Hex(validSave);
                    AssertThrows(delegate { SaveStore.Read(hlLink); }, "Read should reject hardlinked file.");
                    AssertThrows(delegate { SaveStore.SaveWithBackup(hlLink, validSave, hlHash); }, "SaveWithBackup should reject hardlinked file.");
                });

                RunTest("9. JGSE_SIMULATE_GAME_RUNNING=1 makes IsGameRunning() return true and blocks SaveWithBackup", delegate
                {
                    string prevEnv = Environment.GetEnvironmentVariable("JGSE_SIMULATE_GAME_RUNNING");
                    try
                    {
                        Environment.SetEnvironmentVariable("JGSE_SIMULATE_GAME_RUNNING", "1");
                        Assert(SaveStore.IsGameRunning(), "IsGameRunning() should return true when JGSE_SIMULATE_GAME_RUNNING=1.");

                        byte[] validSave = BuildMinimalValidSaveBytes(800);
                        string t9Path = Path.Combine(tempDir, "t9.bytes");
                        AssertThrows(delegate { SaveStore.SaveWithBackup(t9Path, validSave, null); }, "SaveWithBackup should be blocked while game is running.");
                    }
                    finally
                    {
                        Environment.SetEnvironmentVariable("JGSE_SIMULATE_GAME_RUNNING", prevEnv);
                    }
                });

                RunTest("10. SaveWithBackup SHA-256 verification, .backup-*.bak creation, and stale-hash rejection", delegate
                {
                    byte[] oldBytes = BuildMinimalValidSaveBytes(100);
                    string oldHash = ComputeSha256Hex(oldBytes);
                    string t10Path = Path.Combine(tempDir, "t10.bytes");
                    File.WriteAllBytes(t10Path, oldBytes);

                    byte[] newBytes = BuildMinimalValidSaveBytes(9999);
                    string newHash = ComputeSha256Hex(newBytes);

                    SaveStore.SaveWithBackup(t10Path, newBytes, oldHash);

                    string actualNewHash = ComputeSha256Hex(File.ReadAllBytes(t10Path));
                    Assert(string.Equals(actualNewHash, newHash, StringComparison.OrdinalIgnoreCase), "Saved file hash mismatch.");

                    string[] backups = Directory.GetFiles(tempDir, "t10.bytes.backup-*.bak");
                    Assert(backups.Length == 1, "Expected exactly 1 backup file, found " + backups.Length);
                    string backupHash = ComputeSha256Hex(File.ReadAllBytes(backups[0]));
                    Assert(string.Equals(backupHash, oldHash, StringComparison.OrdinalIgnoreCase), "Backup file hash does not match old file.");

                    AssertThrows(delegate { SaveStore.SaveWithBackup(t10Path, oldBytes, oldHash); }, "Stale expectedSha256 should be rejected.");
                });

                RunTest("11. SaveWithBackup holds unbroken TxF lock blocking concurrent writers in both afterLockHook and beforeCommitHook", delegate
                {
                    byte[] origBytes = BuildMinimalValidSaveBytes(200);
                    string origHash = ComputeSha256Hex(origBytes);
                    string t11Path = Path.Combine(tempDir, "t11.bytes");
                    File.WriteAllBytes(t11Path, origBytes);

                    byte[] newBytes = BuildMinimalValidSaveBytes(300);
                    bool concurrentBlockedAfterLock = false;
                    bool concurrentBlockedBeforeCommit = false;

                    Action afterLockHook = delegate
                    {
                        try
                        {
                            using (FileStream fs = File.Open(t11Path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                            {
                                fs.WriteByte(0);
                            }
                        }
                        catch (IOException)
                        {
                            concurrentBlockedAfterLock = true;
                        }
                    };

                    Action beforeCommitHook = delegate
                    {
                        try
                        {
                            using (FileStream fs = File.Open(t11Path, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                            {
                                fs.WriteByte(0);
                            }
                        }
                        catch (IOException)
                        {
                            concurrentBlockedBeforeCommit = true;
                        }
                    };

                    SaveStore.SaveWithBackup(t11Path, newBytes, origHash, afterLockHook, beforeCommitHook);

                    Assert(concurrentBlockedAfterLock, "Concurrent writer was not blocked during afterLockHook.");
                    Assert(concurrentBlockedBeforeCommit, "Concurrent writer was not blocked during beforeCommitHook after handle close.");
                    Assert(string.Equals(ComputeSha256Hex(File.ReadAllBytes(t11Path)), ComputeSha256Hex(newBytes), StringComparison.OrdinalIgnoreCase), "New bytes not committed.");

                    string[] backups = Directory.GetFiles(tempDir, "t11.bytes.backup-*.bak");
                    Assert(backups.Length == 1, "Backup should exist.");
                    Assert(string.Equals(ComputeSha256Hex(File.ReadAllBytes(backups[0])), origHash, StringComparison.OrdinalIgnoreCase), "Backup hash mismatch.");
                });

                RunTest("12. SaveWithBackup fails atomically on new file when concurrent writer creates target before commit", delegate
                {
                    string t12Path = Path.Combine(tempDir, "t12.bytes");
                    byte[] ourBytes = BuildMinimalValidSaveBytes(400);
                    byte[] concurrentBytes = BuildMinimalValidSaveBytes(777);
                    string concurrentHash = ComputeSha256Hex(concurrentBytes);

                    Action beforeCommitHook = delegate
                    {
                        File.WriteAllBytes(t12Path, concurrentBytes);
                    };

                    AssertThrows(delegate
                    {
                        SaveStore.SaveWithBackup(t12Path, ourBytes, null, null, beforeCommitHook);
                    }, "SaveWithBackup should fail when target is created concurrently before commit.");

                    Assert(File.Exists(t12Path), "Concurrent file should still exist.");
                    Assert(string.Equals(ComputeSha256Hex(File.ReadAllBytes(t12Path)), concurrentHash, StringComparison.OrdinalIgnoreCase), "Concurrent file contents were overwritten.");
                });

                RunTest("13. SaveWithBackup rolls back TxF transaction cleanly on InvalidOperationException in beforeCommitHook", delegate
                {
                    byte[] origBytes = BuildMinimalValidSaveBytes(500);
                    string origHash = ComputeSha256Hex(origBytes);
                    string t13Path = Path.Combine(tempDir, "t13.bytes");
                    File.WriteAllBytes(t13Path, origBytes);

                    byte[] newBytes = BuildMinimalValidSaveBytes(600);

                    Action beforeCommitHook = delegate
                    {
                        throw new InvalidOperationException("Simulated failure before commit");
                    };

                    AssertThrows(delegate
                    {
                        SaveStore.SaveWithBackup(t13Path, newBytes, origHash, null, beforeCommitHook);
                    }, "Expected InvalidOperationException to propagate.");

                    Assert(string.Equals(ComputeSha256Hex(File.ReadAllBytes(t13Path)), origHash, StringComparison.OrdinalIgnoreCase), "Original file was not preserved after rollback.");

                    string[] backups = Directory.GetFiles(tempDir, "t13.bytes.backup-*.bak");
                    Assert(backups.Length == 1, "Expected 1 backup file after rollback, found " + backups.Length);

                    string[] pending = Directory.GetFiles(tempDir, "*.pending-*");
                    Assert(pending.Length == 0, "Expected 0 .pending-* files after rollback, found " + pending.Length);
                });

                RunTest("14. SaveEditorForm.DispatchWebMessage(null, saveAsJson, null) rejects silent overwrite", delegate
                {
                    byte[] origBytes = BuildMinimalValidSaveBytes(888);
                    byte[] replBytes = BuildMinimalValidSaveBytes(999);
                    string origHash = ComputeSha256Hex(origBytes);
                    string t14Path = Path.Combine(tempDir, "t14.bytes");
                    File.WriteAllBytes(t14Path, origBytes);

                    Dictionary<string, object> msg = new Dictionary<string, object>();
                    msg["cmd"] = "saveAs";
                    msg["path"] = t14Path;
                    msg["expectedHash"] = origHash;
                    msg["dataB64"] = Convert.ToBase64String(replBytes);

                    JavaScriptSerializer serializer = new JavaScriptSerializer();
                    string saveAsJson = serializer.Serialize(msg);

                    string response = SaveEditorForm.DispatchWebMessage(null, saveAsJson, null);
                    Assert(response != null, "DispatchWebMessage returned null.");
                    Dictionary<string, object> parsed = serializer.Deserialize<Dictionary<string, object>>(response);
                    Assert(parsed != null && !Convert.ToBoolean(parsed["ok"]), "Expected saveAs without dialog to fail.");
                    Assert(response.IndexOf("파일을 선택할 창이 없습니다.", StringComparison.Ordinal) >= 0, "Expected error message not found in response: " + response);
                    Assert(string.Equals(ComputeSha256Hex(File.ReadAllBytes(t14Path)), origHash, StringComparison.OrdinalIgnoreCase), "Original file was modified.");
                });

                RunTest("15. Optional args[0] real save read", delegate
                {
                    if (args != null && args.Length > 0 && !string.IsNullOrEmpty(args[0]))
                    {
                        byte[] realRead = SaveStore.Read(args[0]);
                        SaveStore.ValidateSaveBytes(realRead);
                        Assert(realRead != null, "SaveStore.Read(args[0]) returned null.");
                    }
                    else
                    {
                        Console.WriteLine("  [INFO] No args[0] provided; real save read skipped.");
                    }
                });
            }
            finally
            {
                CleanupDirectory(tempDir);
            }

            Console.WriteLine();
            Console.WriteLine("Summary: passed=" + passed + ", failed=" + failed);
            return failed == 0 ? 0 : 1;
        }

        private static byte[] BuildMinimalValidSaveBytes(int money)
        {
            Dictionary<string, object> pos = new Dictionary<string, object>();
            pos["x"] = 0.0;
            pos["y"] = 0.0;

            Dictionary<string, object> itemDic = new Dictionary<string, object>();
            itemDic["m_Keys"] = new List<object> { 10001 };
            itemDic["m_Values"] = new List<object> { money };

            Dictionary<string, object> effectDic = new Dictionary<string, object>();
            effectDic["m_Keys"] = new List<object>();
            effectDic["m_Values"] = new List<object>();

            Dictionary<string, object> saveData = new Dictionary<string, object>();
            saveData["m_diffucultEnum"] = 2;
            saveData["m_scene"] = 5;
            saveData["m_pos"] = pos;
            saveData["m_gameTime"] = 1200;
            saveData["m_realTime"] = 540;
            saveData["m_effectDic"] = effectDic;
            saveData["m_saveTime"] = 638990123456789012L;
            saveData["m_equips"] = new List<object> { 0, 0, 0, 0 };
            saveData["m_itemDic"] = itemDic;

            JavaScriptSerializer serializer = new JavaScriptSerializer();
            string json = serializer.Serialize(saveData);
            return EncryptBytes(Encoding.UTF8.GetBytes(json));
        }

        private static byte[] BuildMinimalValidGlobalBytes()
        {
            Dictionary<string, object> h1 = new Dictionary<string, object>();
            h1["m_Keys"] = new List<object>();
            Dictionary<string, object> h2 = new Dictionary<string, object>();
            h2["m_Keys"] = new List<object>();

            Dictionary<string, object> globalData = new Dictionary<string, object>();
            globalData["m_guideHash"] = h1;
            globalData["m_achieveHash"] = h2;

            JavaScriptSerializer serializer = new JavaScriptSerializer();
            string json = serializer.Serialize(globalData);
            return EncryptBytes(Encoding.UTF8.GetBytes(json));
        }

        private static byte[] EncryptBytes(byte[] plainBytes)
        {
            using (Rfc2898DeriveBytes rfc = new Rfc2898DeriveBytes(Password, Salt, Pbkdf2Iterations))
            using (Aes aes = Aes.Create())
            {
                aes.KeySize = 256;
                aes.BlockSize = 128;
                aes.Mode = CipherMode.CBC;
                aes.Padding = PaddingMode.PKCS7;
                aes.Key = rfc.GetBytes(32);
                aes.IV = rfc.GetBytes(16);

                using (MemoryStream ms = new MemoryStream())
                {
                    using (CryptoStream cs = new CryptoStream(ms, aes.CreateEncryptor(), CryptoStreamMode.Write))
                    {
                        cs.Write(plainBytes, 0, plainBytes.Length);
                        cs.FlushFinalBlock();
                    }
                    return ms.ToArray();
                }
            }
        }

        private static string ComputeSha256Hex(byte[] data)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(data);
                StringBuilder sb = new StringBuilder(hash.Length * 2);
                for (int i = 0; i < hash.Length; i++)
                {
                    sb.Append(hash[i].ToString("x2"));
                }
                return sb.ToString();
            }
        }

        private static void RunTest(string name, Action body)
        {
            try
            {
                body();
                passed++;
                Console.WriteLine("[PASS] " + name);
            }
            catch (Exception ex)
            {
                failed++;
                Console.WriteLine("[FAIL] " + name + " -> " + ex.GetType().Name + ": " + ex.Message);
            }
        }

        private static void Assert(bool condition, string message)
        {
            if (!condition)
            {
                throw new Exception(message);
            }
        }

        private static void AssertThrows(Action action, string message)
        {
            bool threw = false;
            try
            {
                action();
            }
            catch (Exception)
            {
                threw = true;
            }
            if (!threw)
            {
                throw new Exception(message);
            }
        }

        private static int RunCommand(string fileName, string arguments)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = fileName;
            psi.Arguments = arguments;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;

            using (Process proc = Process.Start(psi))
            {
                proc.StandardOutput.ReadToEnd();
                proc.StandardError.ReadToEnd();
                proc.WaitForExit();
                return proc.ExitCode;
            }
        }

        private static void CleanupDirectory(string dir)
        {
            if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
            {
                return;
            }

            try
            {
                string[] subDirs = Directory.GetDirectories(dir);
                for (int i = 0; i < subDirs.Length; i++)
                {
                    FileAttributes attrs = File.GetAttributes(subDirs[i]);
                    if ((attrs & FileAttributes.ReparsePoint) != 0)
                    {
                        Directory.Delete(subDirs[i], false);
                    }
                    else
                    {
                        CleanupDirectory(subDirs[i]);
                    }
                }

                string[] files = Directory.GetFiles(dir);
                for (int i = 0; i < files.Length; i++)
                {
                    File.SetAttributes(files[i], FileAttributes.Normal);
                    File.Delete(files[i]);
                }

                Directory.Delete(dir, false);
            }
            catch (Exception)
            {
            }
        }
    }
}
