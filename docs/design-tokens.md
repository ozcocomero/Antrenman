# Tasarım tokenları

Ekran 800×480 (yatay), koyu tema, uzaktan okunurluk öncelikli. Değerler `design/*.dc.html` ile birebir.

## Renkler
| Token | Hex | Kullanım |
|---|---|---|
| bg | #0B0E12 | Sayfa zemini |
| surface | #12161C | Kartlar |
| surface-2 | #161B22 | İkincil butonlar |
| border | #2A313B | Kenarlıklar, avatar dolgusu |
| track | #232A33 | Bar/halka arka izi |
| text | #E8ECF1 | Ana metin |
| text-2 | #C3CAD3 | İkincil metin |
| muted | #9AA4B0 | Etiketler |
| primary | #4CC07F | Ana eylem butonu (metin #0B0E12) |
| warn | #F59A3C | Sinyal kesildi, zaman aşımı (şerit zemini #3A2A10, metin #FFD9A8) |
| danger | #F0605A | Kapat/Sil (buton metni #F0908A, kenar #5A2A28) |

Zone renkleri: Z1 #A8B0BA · Z2 #5AA0E0 · Z3 #4CC07F · Z4 #F59A3C · Z5 #F0605A.
Sinyal yokken nabız rengi #6B7480. Zone'lar renkle birlikte her zaman numarayla da gösterilir.

## Tipografi
- Rakamlar ve başlıklar: **Barlow Condensed** 600/700, `font-variant-numeric: tabular-nums`.
- Metin: **IBM Plex Sans** 400/500/600.
- Fontları cihaza yerel kopyala (kiosk çevrimdışı açılabilmeli); Google Fonts'a bağımlı olma.
- Ölçüler: canlı nabız 160px · zone başlığı 58px · süre 50px · ekran başlıkları 32px ·
  kart etiketleri 13–14px, %0,12em harf aralığı, büyük harf.

## Bileşen kuralları
- Dokunma hedefi en az 44px; ana butonlar 48px yükseklik, 10px köşe.
- Kart köşesi 14–16px, dış boşluk 18–20px, kart arası 10–12px.
- Avatar: dairesel, fotoğraf `object-fit: cover`, dışta zone halkası (canlı ekranda 108px, halka 6px).
- Atan kalp: iki vuruşlu animasyon (1 → 1,22 → 1 → 1,10 → 1), süre = 60/nabız sn.
- Emoji yok; ikonlar ince çizgili SVG.
