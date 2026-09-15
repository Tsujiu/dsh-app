# Aviso sobre a fonte chinesa incorporada

`NotoSansSC-Regular.ttf` é a fonte chinesa incorporada ao pacote para renderização
de PDF, garantindo que a exportação não dependa das fontes instaladas na máquina.

- Origem: Noto Sans SC (Google / Adobe, SIL Open Font License 1.1; consulte
  `LICENSE-OFL.txt` no mesmo diretório). Os glifos derivam de Source Han Sans,
  cujo nome de fonte reservado é “Source”; este arquivo não usa esse nome.
- Modificação: `NotoSansSC-VF.ttf` foi instanciada em `wght=400` como Regular
  estática e depois subconfigurada para ASCII imprimível + Latin-1 Supplement +
  símbolos CFF comuns + pontuação CJK + conjunto completo GB2312
  (7827 pontos de código / 8475 glifos), com a tabela de nomes reescrita como
  `Noto Sans SC Regular`. Essa é uma forma de modificação e redistribuição
  permitida pela OFL; os avisos de copyright e licença permanecem neste diretório.
- Geração: `python scripts/build-font.py` (requer fonttools e uma fonte variável
  Noto Sans SC apontada por `NOTO_SANS_SC_VF`; o padrão é
  `C:/Windows/Fonts/NotoSansSC-VF.ttf`).
- Tamanho: aproximadamente 2,4 MB. Para cobrir caracteres tradicionais ou raros,
  instale uma fonte do sistema ou defina `DSH_PDF_FONT` para um `.ttf` / `.otf`;
  coleções `.ttc` não são compatíveis.
