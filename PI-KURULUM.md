# Pi kurulum görevi (Pi'de çalışan Claude Code için)

1. Bu repodaki `CLAUDE.md`, `README.md` ve `docs/` klasörünü oku.
2. Çakışma kontrolü: Pi'de `/home/onel/fitness-tracker/main.py` adında çalışan eski bir program olabilir.
   8080 portunu, Bluetooth'u ya da ekranı (kiosk/tam ekran) kullanıyorsa kullanıcıya söyle; izinsiz durdurma.
3. `./deploy/setup-pi.sh` ile kurulumu yap. Hata çıkarsa nedenini bul ve düzelt; repo dosyasını
   değiştirdiysen ne değiştirdiğini kullanıcıya söyle.
4. `/opt/pt-ekran/deploy/check-hardware.sh` çalıştır; çıktıyı `docs/hardware.md` içindeki "Sonuçlar"
   bölümüne işle.
5. Kullanıcıya kısa bir Türkçe özet ver: neler kuruldu, donanım kontrollerinin sonucu
   (ekran, I2C/SHTC3 adresi, sensör okuması, Bluetooth taraması), yeniden başlatma gerekip gerekmediği.
