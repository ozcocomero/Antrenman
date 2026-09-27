Testleri çalıştır (`pytest -q`). Hepsi geçerse `./deploy/deploy.sh` ile Pi'ye deploy et.
Deploy sonrası `ssh $PT_HOST 'journalctl -u pt-ekran -n 30 --no-pager'` çıktısını özetle.
Test ya da deploy başarısız olursa düzeltmeye girişmeden önce nedenini açıkla.
