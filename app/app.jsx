/* ====================================================================
   PART 1 — engine: formatting, file parsing, column mapping, the
   Revenue Doctor prioritisation rules, allocation planner, sample data
   ==================================================================== */
const { useState, useEffect, useMemo, useRef, useCallback } = React;
const CFG = window.BRAHMASTRA_CONFIG || {};
const API_BASE = String(CFG.API_BASE || "").replace(/\/+$/, "");
const DEMO = !API_BASE;
const ALLOWED_DOMAINS = (Array.isArray(CFG.ALLOWED_DOMAINS) && CFG.ALLOWED_DOMAINS.length ? CFG.ALLOWED_DOMAINS : ["*purview*"]).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
function domainMatches(pattern, domain) {
  if (pattern === "*") return true;
  if (pattern.startsWith("*") && pattern.endsWith("*") && pattern.length > 2) return domain.includes(pattern.slice(1, -1));
  if (pattern.startsWith("*.")) return domain === pattern.slice(2) || domain.endsWith(pattern.slice(1));
  if (pattern.startsWith("*")) return domain.endsWith(pattern.slice(1));
  return domain === pattern;
}
const domainHint = () => ALLOWED_DOMAINS.map((p) => (p === "*" ? "any domain" : p.startsWith("*") && p.endsWith("*") ? `any domain with "${p.slice(1, -1)}" in it` : p)).join(", ");
const PURVIEW_MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFEAAABcCAYAAAAWEVnoAAAlfElEQVR42q19d3wUVff+c2ZrqoBIT0ISSGgJRZqAgBQBRUXFFwUsiDRRQlFAeq+KKCgIgqjgiwURRUEQBBGwUEVRQNLAAirS0rN7vn/slHvvzCbw/n7LZ9nN7szs3DvnPuc5zzn3DgEAwKGXeALSAKTrzzQADeH8IOE9O3wmPpL8QFoMkB4LpMcAabFAagyAWAAxIMTCjxj4KRY+xMDPseDxBzjy9po43mkEdaAc+PVtfHDDD8APwJcC+NMBX1ro1Z8G+JJhfQ/AT4Cf9fcAWhPhZ7D5fQ0Q8vX3mt4EbmC1n9IBTgcQLzRSaafm2DlURqeQw+dURgeWd1xaAdDzAE0FA/CPP8VR3/zFNzxZH546N6AVHQMAnBg1j4+Omrj9ffG6EfD8B9axmYARBAwm67qCrfdMwGHlul8Q3ovHNc6TSW4Akb6R/iQAboDB+lGoNssNJQfTY6ceYmETKr8DJSseDCAWjBhUWVfI/nap+tnLh/e8dgMiusV1qdt4Ie9ld2KnAaOyAWDMA8LmBLysW506SNj4j1g5NDs3i4BQj4X2MbdnuX3MqiVSWZalXi8O25f2TuQyLdbYzR0fHTpxImHjNDASgCCDoMHfoQYiW1TK2jl/Rqg9Qgc69L3jmZf1vXyefE2jTLPMVN9abITUGCp//BKVPZTNzmTHZnBp0Lw+bDxxDEA2QGRaE0V6EPlAHexc9Tp/UH0cl92BpHwW2pihtk14Sn2BcnvRLbVdHXb1HS4TledlysHE+4+EfM38iRz8q/C/2c+/0Nds4Bcvy9gDwvcAbiUAy0gAdQIx4K4ejdiMZvjgyFIuOPDvHWfunrwF/z8ex/RnYwtLjTYafWVCIOmdKGOa0OBfysFEukbvLFycpFkTOLJnLWgVvbj82qmHwIP7Jq5LqJ3Zb0J2gx1LQrAlYE8L/fCBvwql32bWLYUBb+Mq8Dau8pm38nw8/fQ4kr0zw8eCxyaWvbfw6tYvHqcBSGfLEsvHRHYYdk6dwuVfQQ7fifEpj41K6/UMxzySBFclnVAE9d2OXspKP7ma3fHRIMMSQSBo5iGTp0ynq68fR+CfYhN+xH8AIeLOZKw4sJbnTZrC/xsesjMm4powUcE1IgeAv8YhGw43KvgWUQWviXUSBwEArwvwuMBMOhZC8puMf9BgzlSq1+Ixyv84E8GigLydQTkqRiB6QBPM276ax2dM+NbegaR0oIKRJLAM0xKpvE5UO/AaOOI1+hnp+xLWLUYLvZIM3ESidWnmQQ8o1vIhgFYjJ1DRx1nNi/b/YTspwyrdSRURM6Jly3HvvMpPTJ3dtTMBbQm4GUAjEOoAiANwE4AYAF6x7wRbkqkbyZ/r22nGuGY2xj6DKfQ0/zbYFId7soW0ABInjeWE0WNY6kS2LIaZpP2ZYLdA/c3Nwntm4D79z1vHTTzYZX4GXV5y6POS0/+alsTS7wDeFjVR8eG0bcmvLGJm4AAYx8A4BeAMgPNgXAaj2Gyn1X6G3gdknWyoqfLfmg3IrgkTnXliwqgxvzfcvYhjB9eFu0aU+XntPqN6kUu3MAkmjKtJE0ULlCwV6QBqI2fTxmq2syDgvr/mdr/38CDKW/0DghcKTWsWrRIg+LvWRYPDG/iBmXO4LIwsMzAojyfacJCujyembpzHFUalVHclRttYfkSLmzZG3h0XuoKCVRmP7HnFcy6v+AnBglKJI4Za9gMYWcD5C3+c/ngFHxz93DqLdlih2aO3Tqf+NftRweaTCBYFbMdhABTtQ8R/0tH7q/XcZdQkduSMZpRSVvhLZfDEk6ELb/ZdsuKgwlyV2mOe2ePPSNWvPhw7naK9UngRikEZoJUAgLMAJTVZxL6WVU0eCBAOAmhDAJYxPI2qwNOoSt+DtyztW3jw3LDcLTOXY616NuMpYd7MFt5aFb/ztooDMUnnxQS4q8UiamhbdOm4hgt2nVp85sXZo6RDHCKTI4pEXsRCNo9p8kTdoFMhe6fMciiMQR2DSBZ5k2PEyNZbiwcSwIN0aI8F3hW203lgMxN2yRzD3qbV4GlafVmdlMXLEOWveX/u0N99hopTHfBj0vd+gKaPfG6nv0e92zxJNwqWT2YU465XFdGpVUcmpy4ZuWjIU667iYJEADcXQz6yGALLKg5bw5kd+JE+HMneC4lTx3Lt0WOCkLGpQAofyYE2KThl4p6NsWkSDzQEAnJpAsyEPLy/fQJ8DSv/9r53AU+/HSFnKBCjOYvndprT/VG6+uYh8MUiK7RVvLmvYwrGff9xIHHiLDbJdXlqVlieKPEjeTgmL53YuMEXCzj2iURo1XzmlwnTxvUmRgSL8a5iscHioPCd6EGtDeNmBbrA+M7hOMFCCy8lvPO5EHFHChoceo9XrprNTg5j6awp9FLL+yn/05/BJQElNtdHR0wEIvq3Qsqn73NC2ymM66DIbkeeaOyUGHqps2QSR/aoDs3n0htvmXRMr/j3Q57XAmlSLl/Bd+ef0SI9z3tSK+gegSyiS68DzIju99/t4lmHYIFwGEBrALePGO/ese7lUl/rWuaQIn07gKDF+hHVJw0rv36H89778eKZJXMq2v3AGIqfOaetN7Hy197mCVIPGb3mqlkRUUM6IuX0u1y45dipM+lIQeVrINvWVRd4ETGQE/oiqldNkFfTrUBnlwJH1GK9YJCdB+oNyP100Qt5X/4xzsYDAYCfMDGQQZIFMoAm+ma/0N+BpP5D6fLSA5tLTl0QPLyA/EzQqsYg9uk2FeqsXcbJby+Ne5+BjxnYxsBuBt6fPGHvhv6D6crSr/eVZl0wR4f6cCVVQdTwznWTz67mhOnPt2JmhJ6wPZ1jZxUHSjiEQ2TgiCarDmKkIUUi1iYuV/AfGw+UBoE9Fg49GwNIBKMyAEbTxXPuatxjIOWtOoLghUKbhGXs62uZAF96XO7YBQsdh/j2pTPbbuvxIOW//R34sngcTYrdvTcnwX9Xk2+S5r3I5fNEAAl3j5tQv/88VrGAgwIOmWowQbRiiduxouyQrC6LeCR6daeIBTgKRiaAvyX3c+ui6dRu+IOU/9FxcH6JFDiZ5+L3IOKeRhi7bwMPHjeNneLlb+ZMon0te1LhlmPgkoBsbQbb8Hngu/tmpHy5meOfnsyOwznp82nVU9dM44rDE2Z760Vb3jReJdx63BsUPipkJcJQroApl2ku0WmRSb5ed9jPeh7Rd88a9cJnDOBjAO8BeJuAlQRkPTueLp44X7NoT455HpYXDo0MrXI0oh6/BU98uo4fyJj8dhMA9XTIrw6gEhGyRo+i/A8OdC45kG2NKOVcXFUrIGpYN9RZt5ZrTpxzh9Fkd+3nxnBsUiWgoQsh72g1PuXtmUweDeR1SRZjxMIgIG9jLmKeSAH5XBIPFIdy6nPzGD53GD1wIIBY5M39BVF96puhCOsDyuC8ntSbepz59kNO2PQLWs6ZTn7SdcCBgP+Pob/70kBvLZ+8wN8u8VlPw+pQeSsDcNe5CdHJVfonN1vRX/v9SpPPnxtzVNIWZ0zY6YoGxT028Rt/j6atXLVvks6XdNx3N0lETMP4TxMwD9lzxpMW+2g8KNJt8rvQa8ixEGnwt7lJ5lUK/cleuICurDpl44HSw++Bt3FlfT+RBwqh33MBKj54TuKBRvONIahVikT0gJvxw5Y1vHvoxA1QciyDJ84cO+jexynvtf0I/pWn8FJLPfK1SoKrR8MjnRcuYpjyioVBuYdmtT75yf1U8O434PwSqd0mZnvciOjbIeRYKcot4xQ7i9jhOCAAcHHgqsoDbQqOxO/IhokAdEwKg5tsRQ3u5BsR/WTr+3Y99SpvrTuruZpjGf3CDBrVtjcVbPoBXBwQ8JKsc/G64b+zMTru+YSbjZvJJs0R9MPsamOpeO+xesXf/SrjrYDt8RnTFmskYBmpgXgQkoUZeqCJidbD56wHWqlHEixZihxolZXfZeEc9O1+UKIeMeLxtU6A98707zeWPG+ynbEEZBAwhICssc9S/senmhV/l2OPVPR2u26MQeSj7dH4o/WcmDF5uQXboW2ymo86kTlgAOWv/AK4XCBgZaiNQSa3W9TRWQQ1XR63MIWU4FcwtgkejxPXMo0oEJRyIvKXA62DvcUS5rIuhDEzeGkghNlm7G2ApRv+ng2x4Z8NXLjwJ8znKSTmTfzIOOwDaMTTk45H3NO4vqtWJcdcibtudbjr1hiS1ChuCOfnp2aeyDhp9sMVANGg5PXr2dOotjTMNLBPMy3M4IEGJoJRdPTyjsCfhXYeKPRig69f5YjbasCmBwqWWLT7tzwuCjrwQOtR953K7E6uZNMDGU0AJKM059Lk0pyLgkVrkkW7boxC1GOtsGrrOn4+Y+JeVTNZsWRWg+VdHqCC9d8jeKXIPF/pfIjgbVMfvnbpJxLjX2KVL5uRGGkSA9FYwSsxz5Dz7PwuV97NOWbjgeIhozxw171B4nes8MScfYui8zf9GoYH6imWljWhVY2G/XyOADiN+IUjZsV1fYDy1h5G4J8CGy81/nYlVkb0kx3aLHxzBc+YNq+92pnrpo+nxi16eIp2/yJzS5HD+jzw9WyOlIbbOGHTXGsQsp3rhniixO80GROrETSf620bD2RZMiN1P4eIBUUBhyQ5dExcrPA7/WoT4RjMcBsMIHvGZPrllt5U8PFP4KKAxDtF6/K2SoLv/qa7J7y4mO8l4A4COhHQFoT3iEozhw2jq6/vfqbkSK6MtRSycoDgqhiDiIc7ou6uTRw/fMoxFZOJCAztshZKcJAcExltOQcw2CfmRBh2THTKvzCHq73RPaQZ7z4O8MiwsXAjU9oKvd6JUJ7llhnPUtGBPxKK9mSa5yV5YQMvu6chde8nnDBhNu/Qz+kAgB8B7Fo09YXT/R6hvFe2XQ2cvQBRRbLaRXAlVEXksDsbuevWskUzGiFfcyyhIJYlbQc90HIaUCIWERcdmLfEA4VHKYeJWkInXJOruNVcSIfVg3NvP/gkXX1973OlP50zMVu1aK1SNCL7t8XQz97nWk9P2mEFr6HXQ6/OjDnY7R4qXL8X/G+eErtbGEh+r8QujDZoNh4YVGSxICJlHkl6tiv0yP8oE4FLRXYeKDS2/vzX2Nuiho0vij2c99YRcFFAyomIsHlw+cslOeve5B+nze0o5liYgPvqzJh3f7VH6OrKPQj8nWfDVQsvqyB6aJdOfdas4XumLWyj4uWJWePoZK9uVLj5e3BBiZKhtGsEzEAQYM3OAwVMu0nIkYg8UNATs2fPofyPshx4oBCgV4qAJ7WybMlmQmg1QIuRPXcmlRw7p1RAEH4SGuptnoDo3o2/PPzii6bnXP6q1ZkDpk+nk+3uocItPyoRhiZxVU+LZLh7tdjb9fklDBCqgBALMkvysj/PoJJ9h1NL9v9sw0AIbAakIWh4ZwOjWE3g/y3HuqZ30mT8C1wqPOukB4pqudFq0cOFDvw4wBkATwYXBqyP9eM0NPDQwCm3hogeDXBoy0be2X4mDx1uOR4AmMPA06MyKH/N3n7FR8/YWYNJDN3wd2+GlD1bOX78HL4EoMiAbGJkZmacPO0aQAUrt8wt+THHxEAzR6MfWAOgqVeMDK9hCLO6+iJHIpriWbRSZz1Q9OAk5U6cCxXZxgMZTQHUUXCI4KoUjaiHb8HO7u/wR79MWSSlUQGMnTf5nQl9HqH813YieP6KYP2aTkpCf2sVYxDZvyNu/ngjJw+fslPKrxCQ8/C0Cafv600Fyz91Zhhgn+ak1MptZL/K79iu1dj1QPG7YNBZd7TJyZpDjuUwgF9DMTDbiy5cdaogcnCHUR8cX8HrNr1aU621mbN4Bs3p0JMKNn4PvlpkVjCosbArsSqihva4LXn+Wk5uvfA2ta9yX5lGgdxzEkvRDTNPs9XGsOCNbyQAVCjxQFVPpHIKdQgo+PgUUBiw80AOYWL8yIiTqdvrsjvpRrseqF+yQNaF5Xy1WBgt8tPbpg48KclnV8xewGOIbAVMSyeOoTyttGLJnuMmDySHQlZPixS472+3M7HGMhbrIUPtZruWoLn/1Gy1MWKy6l/dEuGgVocNlMlWw5i1bQYV7Myy80AigAcAjChXQkVoVWIsTZNlz1lj8fBhhXty6hXtzZTjXjFPHemF/74WqLtzE88fMZnVIb765u4X1wwbQldXfTGm9KczVtJNOC/mEF56uzVHStKXHP+uEbGw1AVmfiXI0ZqzIs1SGYjKA8lJSJA8u2azxuA/BWWUlUHK4cilzlZf1R418ESdgUMo77Xda0pPnpc5nIDp7moVEDW0K+a+9w5PGjPrCVnWY2xYNGXRh336UP7yrQievyTFwiIP1CrGIKL/7ajz2WaOGz51L0nYrpksRIMDn7Jqy+ReRxmaohSp2HIsFviIPFCaJREmFnYqyGy6eOaApgP7Ut6qPQj+dcUWRRj7eRrFwT+gw8qxS5bzXQ7FnduXTqftnbtR4Xt7ELxa4MgDwYCrdg1EDOnVRkuoZsNs0uiqxkH5ChBpUlEPBRFl0wPtE2IioSg4TErEoijWITwhgN4AgYrFnIgYCzM3sxfI68fteHgqtb/1bir86BC4oMQRK4kIvs7pSN3/BQ+atIBFx2MIsd/MeIZOtu5AxV8eBUpZ4oESBvp8El8ENASCiNJIE3kggYMOJSWs5oVZjZWjVB5IauwcVCbmsPHZAKBWhfsDf162Ppd46yGAgd/HvMpnXnuTTyxaWs+sBgOA0cBd1cdQ8NRf1Qv3/CLncIRYmGIj4X/oVgzc/BE/MHzqflW5/5cIxzMGUdHaLwaWHs+10QzL2knyIRqYNDnPauCRWNhILgMHzX+k8sRQDYTMAxW41BRlWrD43Gd/O3yi/Y8UyL1oq9kGmoFRF+Rywdc+Ff5OqT8fe/Flfvec7KPuSen7Z9/HB1P+6ztnlB7/zZ4T0V9dCdUQOezO1vetXsvdZy6+Wc2xZK6fsPrXNfdSwZqt4Et5gkVrSsRiRV2aI79TEvhsq10pgyc6RSyiMCNuE5T8HUqy/7HxQMYhAKeE2M8NX7c0pH63lb9qNcd0+IYXHrRo+tTBvR+kvOXbUPrHRbsGqL93N0+Bt3vLAx3nLGHblDQCcj0T6GRuOyra9LWEl7a6R811QVNrpB10wXxbNZVdcMm3qSc2FYfseWECQGsAejn0ZwAOPJCFgk7LQrWYCET0a4ddHT/gjUdmzHqhGawJQwCefXk6Pdv5Dir6cD/4SqFjVZrm88LX8xZ02LWLm4yewyaWC8/sXk/TqTatqXjbNzbMBggBEGvspAcKfRBkVGC1xlctnWNL6XGmL6K3I6Vm+zGARyhemZyLnB2UcXdyFcQMum1i4uJXmV1s22/61Geoa+vb3MVfHLUwWxp5BKoUC/+j3ZG+YRPXvnfGfKu0kE2ynf3sYAqcOiNELKEL5oJWrCGo8EBVT2Ryk9OULZaKyfyqaUremdhB59O9syT3kH07vtks1nDKiRiY7uvaGBv2bedVU+azOgHyViCwaOQQyn/ry94lh06buRLVm7vqxCNiwJ1jk+54k5v1yY2xRpJ+xNKAErFoAAI+jUU117AClSc68cDr4YmiR3ao2VZlcjW+FmeCSpgrWTeAG6Lg/087rNyxhZ8fPrlY5ZcrFozbkPXYQ1Sw4rN3Atnn5PMxttM0uNs1xpX83y/X/uVlRkPZWpwmTGhqNRWJ+Q/ZvYZXrJkCBq9y3J/E+im1FkcpcVbywlzmRBqxIsPCXFe1iogc1tOz8J31PGPyC7cav99D/43cpdP6vXd3Typ4axuCf1+S2AkZTCQqCt77OqHOll0cN2zqXwCBPB4Js8nARNJI5oGquEBcavE7kqzAuopcAjUSCTrnWCQe6DQnBjJvBR1UEuPW9yVHcxC8lG/LiRjbudOT4L6n9VfjZ77EDOAzBnYCMPKpW1+YQFs7d6KizfvA+UVC1CPwwOqVETHkP5UT3/yQER0lYTYDcAXh1cxqLxL5D1vxM5NbijSUvLOOZX6b91NpkoN3JLVmmwA7b4UgFst6YMmhLJy4pSsV7zimjCIh0vB54e/VFs9+toUHPzVtl8gJjfdfT3ySklq38pV8dcSBB+rqTuN60KrcaK/gkHiiLcdiDrGisuqx1dJ423bC6Lbrger0RArDSe0xtVHZ+/hzQPebhlDeWzsfKT6cGTYn4qp1EyIH39XhiWVv8WKGR8XLtYTiH0Y8SkWrP36u9Odse64nXB2mIUCIPUsa2WY92ev+FMmMLduxKss0BcpU9dzYTs1hK5UWofkQjiqLWLff+5GJb/+nfz8qWLa5OPjHv7ZIxchje9qk4cjefcX3jVvIYjWr8f7XTybNO73+Lip6+1MEL14Jq18aviQQSlTJ1sVB54jFKUPnFLEYPFCe5qV6V5L4ozrPhR3mvuh0y3E0iDmWx1+Z5Xu8azcq3LAHwauFSk5Er+WJiYTvoa7o9cnn3CljpnQ4rxGxRI2jXzu2puJd34VWBFBZiH5MDSCNSO5pOccCaBQMOEYittBO1gOJ2SFikfPCJnQI82hUHsh0QCgqUHM4LHUgCwCQMW00+aIKK5TsOeY4C5VIgyu+GvwD7sFtn+3gm0fPlWMFArAByL7jMSpYs/HV4OkzUmWGNWNWKy4/YgGxnd85r4bBHGbupBA3SzzQYR6xygMlCUyJf6XZTQ7Xdlh6l0uThj9GhW9sHlfyY1ZYbNOqV4Hv4Z5oumk717x92gGVTZ1dOmn46d5dKfj7efvsAQS9mnUpNXtUIuZPJB6oCNdBuUY6ZEGazbGo/M5u4A4xPDcPNV5TcyKabTiHm2U/Z9HkBQv73keFqz4B/3XJVtNtWJYrvgYiBj1wc9JdGzju0vwB4loUAMB5BXIe21S2dQlEqiNzSkKxUsMoh1alKg9UhzM75ESMWQnmMyjOStDPyxjODjxQxcNw8bbxePWlybSsa0cq/Gg3uKBI4bpWH7iaNID/kXtW1856g8WpbggEHfPYmqiOSCqssXNQ89kwhUiZ00VuFXOY5ByLyuHIvMrC2NWsvLYZieiWaLIEtT6wjOHsvOYDY+3Upymw+2hq6bfHrFmvYrSiW6qnUxskZx/g+FELQrtrmt3rA9Bs3CzgYIkcdpK9Ld41+zVon+qKcJxUMBt7Dvx7+Tck/GVLS6TrWzRj/fiBJz8a+hAVrtq4LpB5NiwPpIo3wPvwvUj67zam6GjH3I9GLPNAkydaNTn5UgRhVP0r8wDV+kA1x0KKHgjjtxwyfqKCzNxCnn2qWrwkyorzBsVISV1Iw7KS7a9M6b/z/m5UtPYT8IVLjjO0CBq01GRo1as6Ziw1u9e0ialFNh7o4J0NTLHNlVNVbamSQgXKsrN8qh4IRdV2tEDlVG9Xvq+nv/9u0Tg60LkVFX++B1xUbPLAsLU8Ql2n28AfiSQJYiTAPggWGJoUo8z6ETCPCc45FlN/s6oS7KsCKBZmvgqoSKIQQvIyBvbLIgaOyhIxDsOdCLn1QAn5i9pQfOJed9NGFqdV1RQherMiFmVmqNCyIjUPy3b3bMtB2LJ9DnlhGyYaq32IvNXARDUuZ2tCebnWWIbDsX1GQObJ0fuyzvWiwpXvnAjk/i5HdCxHThR0saZWLlCEV64fBGy8yiHvXGYtTthtbGkGp/pxS8VRs23GeZTdgeE1SbYtpCGf3pmeU+plNW1PJR98Ar6cZ/vt0OyGoFeTQSv0kpz3EssaIDlHFKIoW9ZlJjtIhXggSyvY2UaEsHyB4bnFWJilJNa1WeBW5fPjyvd5JIsmTEDO3JFUvH5jtsmnBVwOQit2q5OcCYC/QzJSs97m/JW/7IdGP6jfh86YBUvi0lB+2raskQSzId4nr0oHh4JQa9IQKW5FsRrBCTpZozMGctnDWSLwjLnx0F578Z2Ab3BbiKukGH7A7fNluQN/XoWraowtonDVroSYYW1uKc28cItaOxOmPlOVapWIhcvOrQgem5TtbKq6adRcTgdeKwF3joDi97/CnuiOcN/aFk4ruAXz8pCzMGOHlrf550mB3y7b9UAdl9xJlW3zRGyLxICKbDXS6qSBcHP7lE5Ua7ZZ8d72yEgczuF5otOEcZUzst7+2rEzODntW/beeycoKlpWj/TzD2bnouTDj4YDgPvM/FmzMR+za8+YxRF3NQRFei39jRBmbp9tZd5g2Ll9ZB0H7ADyJAe4HG7NWiKHuX0kLcrrVCopog8A9NA/2udglU1GzB3uapa+1NeovskDbdrmlaso2bIduc9nhMBnibAuTvaaiVR8vuSmoq8yJSXHVhtDBG96TdR+Y2mCcAoxjnPloNIqux4oYyI5zhMRLUiq5THwTpzQKWIgCw5L6K6dSv0NM6PtonXse6TPUnejBo7VaSBC6Ze7kdmpPhkdaPyENO5OL3vg79NnnqK81/a/VHLivFUFpdQoupKrwpeWmJ0w2VyHJk+tD1RzLE7zhctXyB2WeVOjGged+HowsPtzL/Ptu4+xu31rm4pvPEuP/YTit9YPzBnb34nbwW3jRwBy2mAk6mFkwqqp7O/VBK6K0bJUBoIW5Udk31uQ0nEjl574Q6lsJXVtIisWJtirck2vIsTM5vECci2PwQ35f1NxjB36DJl22dOza4y3ek+FnegWyEDwz3Mo3rwVZ5dPIQwIv5KpG06VYEZnzptOACPxpcXsu60+yOsWsFIvya1eAd7qFW0lZUHl4rCoB4bx9LxMmScCANwSTD+H1sdmpS7cyP+WpeIoi5XHjVl4/8CGqR/40hso6Q7BKV3NQ+mO3ciZMZTQvKV0okQybuuLUFqLL0p1iYIYmZUxkgre/e6hkqNnlRpph5lYhh7ITnRR1QNlUZbYHtUwfWs20l4fyNcsgwHA6OffYl/fez9wN26o1OJYGFi6/3vElsTF5twwlLDdlhC2J8mkxcrLWXwxZ/bk9b/2eYyuLttxMZB7wVYjreqF7gZxiHt68kE1xyIrIuKPzJMjJ9OCWoFR3xGvjOW2GM75M+P9tAkv8aTdR9ndsa1NJTKOGTiZicJV6xYdW9Obvl0bfeV6ltJ1m1HINS4wdual2RUBIGHSbPbf2Qx0Q6QUyRjW4kqujqjkGs3qtE/jq8m1KtCGrxRvr0L9eIDrQ11nm/EtgBgrByOss62uJM9CHpYBLBo2/ay3R6ea3t49dRQi5eIRcOFfFG3Zjn2Lx5HPAyBtgrKwuj1yunZMLGfZuxxMJMxiJL6whL1d0gC320aOGYCrXhxiLuZdDDatY4s6bHrYK7Ct8fCb/lWcMmaN2un/jrM+y9APtnrs4q6ulNrb/IP6hdEvAS4uRemXXyN34uOmsldVuiAkR6AiJiqQ7pbX/BLq8ehaFicnZAEUP//FJu7KNxz2tKxrzlYSuZ1WMQZahRi7HqgpZ7QMSs0PUJNbwUfHUarE1Ma/BxdatxJBdcb6BW+wr0MrwOOVRggLuBI4+hOCp0+3/2Buxp6WGIAT+s+fI0JVAgrFkFKxQmaZ5bBsiaysp8q41iXdc8eNOgKA4kdOWetpn97PnVJDXrnTWfkJW5soXrWQY4mx5sHIqT/TsWxZspg9XW+Fu0u7sDw0eP4fFH/0WemaFVM8PieOarT5OhagFEBGXZC2nIV4w+Bm7uIZ/U/f15sK3tiB4LnLYarABC5WIcamPjjVbANyFYW47s7e09OP7snfxd7ed4AqxDrkhQkoKETJps+x4I7m9NuKqR6nmzeIi5WzzcFez2Ll75VzBa5h5XwAyH1hMp3q0p0KN+0H5xdJqrbIA3092yHpvd5ca3iVXyBlYclei+OgjLs7tob/iQfTtfga+j5ky4mUfncEBbuP1p09YxgBoQXbxOYcVVTtf6XJS3ZDCn9TGwMSHyzL0q7/Bg45k0dR7RtXJmqaN9N9S0NByLCulLtebbjrJaYmNjvO2o0VbZENQ63lsTDVVau6BfjKKsbBs7+jeOvOH8ctn5LmZ0HcIC5bBhP0STOribJv4FBmxGI3w3IAwmGT7OWDspAOijs+fYm3Q9OnXMk1hQZZ5+du3tCW45YOpc+FDqtfGh11NR+lX3yFwTOHk++edsDy68i7qIrQ9S5WTuXe0OZ/uIGDsNuZWvOfPh01iArXbUPw3yvSumJOkYOoBGVyA7ia1IdTJYaIgaX7D2JuhzTtkZnDyemGDWLFrlNtojWPxaGM5pqa3QihxWLmwrpbWhz+3x4uCHdfiwzdMa3bOQBAwrxl7O3cAvB4YAs7hLWwS745Bk+DZCAmWtqOBdE2mHkWxV9+ve63Vyf3d8YcLluWNx5RMO+SFkgHtHSA0gCuoOjCCoJZPJEI6GcvHwmfcLo247Td2+TPukDVGOTgXUqcdKUrUpK2eRqnWuoOy4qNt1XjUMKIIbEIYgJfvorirV+iY7dR5JvREf5XJsGn32JOvKmNeMu5PsTYCvlmNta2hBpGssrATrpengjhTjj0v/ZaGGYkdqZ+zKxZe7YDRyjuqRT23H0bXFVulBV0Nf43sDIQQMneg0gf2Y/8PzS5DhmsvO/ZEjauGxMpzA1dyiOG14qR5ZDXM0v/pMzbN1Pxp3uAohLnuYb6OQVP56J47cZxKev7EQbJiww5dxA55KHLxkNWCfe13OjL3G4tgAVhNFNcG6yUa41V1Q3eATBUj8f/pupFX7XxJdXa625cX/a6V/JQvHUXzswbQbdGdgbSQh33wQig/y7rN14I5+CER49yLnr0cqB0mX2Cp4SJ8o2+rNCJHi4LE9V1H9gZZcsczgycB3CTSDL6Sj/0BwX3gS9SrSfX53nv6RapRUeheNe38E/qRhUwANWU1GbvJbIoO5oVvBNu9GVipBMeQrht55Mi5SmfJ/4fzE2OofoE4vQAAAAASUVORK5CYII=";
const APP_VERSION = "2.89.1";

/* ---------- SAAG matrix (lib/saag.js) and the team's standard note ---------- */
const SAAG = window.SAAG || { statuses: [], subStatuses: [], actions: [], effective: [], rows: [] };
/* Sub-statuses the team needs that the SAAG workbook does not have yet, each with the actions of a sibling under the
   same status. A line does nothing once the workbook (lib/saag.js) carries it; add it to the workbook too. */
const SAAG_ADD = [["Claim Not On File", "Policy Active", "Claim available in Clearing House"]];
SAAG_ADD.forEach(([st, sub, like]) => {
  const si = SAAG.statuses.indexOf(st), li = SAAG.subStatuses.indexOf(like);
  if (si < 0 || li < 0) return;
  let ui = SAAG.subStatuses.indexOf(sub);
  if (ui >= 0 && SAAG.rows.some((r) => r[0] === si && r[1] === ui)) return;
  if (ui < 0) { SAAG.subStatuses.push(sub); ui = SAAG.subStatuses.length - 1; }
  SAAG.rows.filter((r) => r[0] === si && r[1] === li).forEach((r) => SAAG.rows.push([si, ui, r[2], r[3]]));
});
const SAAG_INDEX = (() => {
  const subsByStatus = new Map(), actsByKey = new Map();
  SAAG.rows.forEach(([si, ui, ai, ei]) => {
    const s = SAAG.statuses[si], u = SAAG.subStatuses[ui], a = SAAG.actions[ai], e = SAAG.effective[ei] || "";
    if (s == null || u == null || a == null) return;
    if (!subsByStatus.has(s)) subsByStatus.set(s, new Set());
    subsByStatus.get(s).add(u);
    const k = s + "\u0001" + u;
    if (!actsByKey.has(k)) actsByKey.set(k, []);
    actsByKey.get(k).push({ action: a, effective: e });
  });
  return { subsByStatus, actsByKey };
})();
const saagSubs = (status) => [...(SAAG_INDEX.subsByStatus.get(status) || [])].sort((a, b) => a.localeCompare(b));
const saagActions = (status, sub) => (SAAG_INDEX.actsByKey.get(status + "\u0001" + sub) || []).slice().sort((a, b) => a.action.localeCompare(b.action));
const BUCKETS4 = ["Payer", "Client", "Closed", "Purview"];
const EFFECTIVE_BUCKET = { "Pending-Collectible Insurance": "Payer", "Pending-Client Assistance": "Client", "Pending-Collectible Patient": "Client", "Pending-Purview internal review": "Purview", "Processing-Closed": "Closed", "Payment-Cash In Bank": "Closed" };
const EFFECTIVE_DAYS = { "Pending-Collectible Insurance": 30, "Pending-Client Assistance": 14, "Pending-Collectible Patient": 30, "Pending-Purview internal review": 7 };
const NOTE_SOURCES = ["Call", "Portal", "IVR", "EOB/ERA", "Email", "Clearinghouse", "Client", "Other"];
const DESIGNATIONS = ["Biller", "Sr Biller", "SME", "TL", "Sr TL", "Assistant Manager", "Manager", "Sr Manager"];
const PRECHECKS = ["Eligibility active on DOS", "Claim status with payer", "Timely filing limit", "Appeal filing limit", "Auth / referral on file", "Prior notes read", "EOB / ERA reviewed", "Patient demographics / member ID", "Payer ID / address", "Coding (CPT, DX, modifiers)"];
/* SAAG choices that must carry the document (EOB, appeal or reconsideration). Keep in step with attachNeeded() in worker.js. */
const ATTACH_RULE = {
  subs: /^(EOB Available|Claim Applied Towards Offset\(EOB Available\)|POTF available)$/i,
  actions: /^(Need to Post\/Posting Correction|Need to Appeal|Need to Appeal Mail|Appeal Sent|Paper Appeal|PLSAPPEAL|Recon\/Appeal In Process)$/i,
};
const attachNeeded = (saag) => (ATTACH_RULE.subs.test((saag && saag.sub_status) || "") ? saag.sub_status : ATTACH_RULE.actions.test((saag && saag.action) || "") ? saag.action : "");
const isClosedSaag = (saag) => !!(saag && saag.bucket === "Closed") || /^(processing-closed|payment-cash in bank)$/i.test((saag && saag.effective) || "");
const mmdd = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : (iso || ""));
/* TFL (timely filing limit, days from DOS) and AFL (appeal filing limit, days from the denial / EOB date). Same rule as limitDays in worker.js. */
const limDays = (v) => { const m = /^\s*(\d{1,4})\s*(d|days?)?\s*$/i.exec(String(v == null ? "" : v)); const n = m ? Number(m[1]) : 0; return n > 0 && n <= 3650 ? n : null; };
const tflDeadline = (dos, days) => (dos && /^\d{4}-\d{2}-\d{2}$/.test(dos) && days ? addDaysISO(dos, days) : "");
const daysUntil = (iso) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(todayISO() + "T00:00:00Z")) / 86400000);
const riskColor = (left) => (left < 0 ? "#A32D2D" : left <= 30 ? "#854F0B" : undefined);
/* Call start / end (HH:MM), entered by the biller for a call: for the Excel and the dashboard only, not the note text. Same rules as callMinutes in worker.js. */
const callMins = (a, b) => { if (!/^\d{2}:\d{2}$/.test(a || "") || !/^\d{2}:\d{2}$/.test(b || "")) return null; const t = (x) => +x.slice(0, 2) * 60 + +x.slice(3, 5); let d = t(b) - t(a); if (d < 0) d += 1440; return d; };
function composeNote(fields, saag, followUp) {
  const t = (v) => String(v == null ? "" : v).replace(/\s*\|\s*/g, " / ").replace(/\s+/g, " ").trim();
  const pre = [...(fields.precheck || []), fields.precheck_text].map(t).filter(Boolean).join("; ");
  const parts = [
    `DOS: ${t(fields.dos) || "-"}`, `CLM#: ${t(fields.clm) || "-"}`, `DENIAL: ${t(fields.denial) || "-"}`,
    `SOURCE: ${t(fields.source) || "-"}${t(fields.ref) ? ", REF: " + t(fields.ref) : (fields.source === "Call" ? ", REF: none" : "")}`,
    `PRE CALL CHECK: ${pre || "-"}`, `RCA/FINDINGS: ${t(fields.findings) || "-"}`,
    ...(/^\d{4}-\d{2}-\d{2}$/.test(fields.denial_date || "") ? [`DENIAL DATE: ${mmdd(fields.denial_date)}`] : []),
    ...(limDays(fields.tfl) ? [`TFL: ${limDays(fields.tfl)} days`] : []), ...(limDays(fields.afl) ? [`AFL: ${limDays(fields.afl)} days`] : []),
    ...(saag ? [`SAAG: ${t(saag.status) || "-"} > ${t(saag.sub_status) || "-"} > ${t(saag.action) || "-"}`, `BUCKET: ${t(saag.bucket) || "-"}`, `EFFECTIVE: ${t(saag.effective) || "-"}`] : []),
  ];
  if (followUp) parts.push(`FOLLOW-UP: ${mmdd(followUp)}`);
  return parts.join(" | ");
}
/* Row colour on the biller's list: green when the SAAG entry closed the claim, yellow when it was worked with any other status, white when not worked yet. */
function workTone(c) {
  if (c.state === "closed") return "tr-green";
  if (!c.last_status_code) return "";
  const worked = c.completed_at && (!c.assigned_at || c.completed_at >= c.assigned_at);
  if (!worked) return "";
  return isClosedSaag({ bucket: c.last_bucket, effective: c.last_effective }) ? "tr-green" : "tr-yellow";
}

/* ---------- Purview Gurukul denial library (lib/denial-library.js): next-step suggestions ---------- */
const LIB = window.DENIAL_LIBRARY || [];
const LIB_ALIASES = window.DENIAL_ALIASES || {};
const SAAG_TO_LIBRARY = {
  "TFL Exceeded/ POTFL Available": "Timely filing expired", "TFL Exceeded/No POTFL": "Timely filing expired", "POTF available": "Timely filing expired",
  "Denied for Auth- referral": "Authorization absent or missing", "Requested PA - Fax/Email": "Authorization absent or missing",
  "COB Issue": "Other payer is primary", "Covered By Another payer": "Other payer is primary", "Need Primary EOB": "Primary EOB required",
  "Duplicate Claim": "Duplicate claim", "Code Inclusive/ Bundle": "Bundled / Inclusive", "Policy Inactive on DOS": "Coverage terminated",
  "Incorrect Mem ID/DOB/Demo/Eligibility": "Patient cannot be identified", "Incorrect Mem ID/DOB/Demo": "Patient cannot be identified",
  "Deemed Experimental/Medical Necessity": "Medically not necessary", "Provider not Credential/OON": "Non-covered — provider out of network",
  "Claim Paid To Patient": "Claim paid to patient", "Claim available in Clearing House": "No claim on file", "Medical Records": "Information requested from provider",
  "Information Requested From Patient": "Information requested from patient", "Applied to Ded/Copay/Coins": "Claim applied towards deductible",
  "Max Benefit Reached/Unit Issue": "Maximum benefit exhausted", "Max Benefit Reached": "Maximum benefit exhausted",
  "Non Covered Service as per Patient's Plan": "Non-covered charges", "Non Covered Service as per Provider Contarct": "Non-covered charges",
  "Denied For Incorrect POS": "Invalid place of service", "Invalid DX Code": "Diagnosis invalid for date of service", "Invalid Modifier": "Invalid modifier on date of service",
  "CPT Missing/Invalid": "Procedure code invalid on date of service", "CPT/DX Inconsistanat with Age": "Diagnosis inconsistent with patient age",
  "Level Of Care": "Level of service not supported", "Denied as hospice enrollment": "Patient enrolled in hospice", "Skilled Nursing Facility": "Patient in a Skilled Nursing Facility stay",
  "Capitation Plan": "Capitation / managed care", "Taxonomy/NPI/Tax ID/CLIA/NDC invalid/Mediciad id /ETIN missing": "Procedure inconsistent with provider type / taxonomy",
  "EVV Verification": "EVV visit not verified or not matched", "Manufacturing Invoice Requested": "Manufacturer invoice requested",
  "Medicare Part B deductible not covered": "Medicare Part B deductible not covered by secondary",
  "Patient not Eligible for Exam": "Vision benefit not eligible: exam or materials", "Patient not Eligible for Exam & Materials": "Vision benefit not eligible: exam or materials", "Patient not Eligible for Material": "Vision benefit not eligible: exam or materials",
  "Refused to provide EOB": "Payer refused to share claim details", "UCHP Plan": "UCHP plan (University of Chicago Health Plan)", "W-9 Form Requested": "W-9 form requested", "Denied for W9 Form": "W-9 form requested",
  "Claim Processed Incorrectly": "Prior processing information incorrect", "Under Paid": "Claim underpaid (no line denied)", "Need to allow some time": "Claim in process",
  "Claim Applied Towards Offset(EOB Available)": "Claim paid and applied towards offset", "Claim Applied Towards Offset(Not Avalable)": "Claim paid and applied towards offset",
  "Set to Pay": "Claim is approved to pay", "Remaining is contractual Adjustment": "Charge exceeds fee schedule", "Recently processed": "Claim paid", "Recently paid": "Claim paid", "Already Posted": "Claim paid",
};
function suggestFor({ subStatus, claim }) {
  const out = [], seen = new Set();
  const push = (entry, why, score) => { if (entry && !seen.has(entry.name)) { seen.add(entry.name); out.push({ entry, why, score }); } };
  const byName = (n) => LIB.find((x) => x.name === n);
  if (subStatus && SAAG_TO_LIBRARY[subStatus]) push(byName(SAAG_TO_LIBRARY[subStatus]), "SAAG sub-status: " + subStatus, 100);
  const text = [subStatus, claim.file_sub_status, claim.file_status, claim.file_action, claim.file_comments, claim.last_note].filter(Boolean).join(" \n ").toLowerCase();
  if (text.trim()) {
    const scored = LIB.map((e) => {
      let s = 0;
      (e.keywords || []).forEach((k) => { if (k.length >= 4 && text.includes(k.toLowerCase())) s += Math.min(6, 2 + k.length / 6); });
      (LIB_ALIASES[e.name] || []).forEach((k) => { if (text.includes(k.toLowerCase())) s += 3; });
      (e.codes || []).forEach((code) => { if (new RegExp("(^|[^0-9a-z])(co|pr|oa|pi)?[-\\s]?" + String(code).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^0-9a-z]|$)", "i").test(text)) s += 4; });
      return { e, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
    scored.forEach((x) => push(x.e, "matches the file's status and notes", x.s));
  }
  return out.slice(0, 3);
}

/* ---------- formatting ---------- */
/* Attachment types that may open in a browser tab. Never SVG or HTML: those can carry a script that runs as the app. */
const SAFE_VIEW = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/plain)$/i;
const fmtMoney = (n, dec = 0) => (n == null || isNaN(Number(n))) ? "–" : (Number(n) < 0 ? "-" : "") + "$" + Math.abs(Number(n)).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtInt = (n) => Number(n || 0).toLocaleString();
const fmtPct = (n, dec = 0) => (n == null || isNaN(n)) ? "–" : Number(n).toFixed(dec) + "%";
const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayISO = () => isoOf(new Date());
function fmtDate(iso) { if (!iso) return "–"; const [y, m, d] = String(iso).split("-").map(Number); if (!y || !m || !d) return String(iso); return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
function fmtWhen(ms) { if (!ms) return "–"; const d = new Date(Number(ms)); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function dayBounds(iso) { const [y, m, d] = iso.split("-").map(Number); return [new Date(y, m - 1, d, 0, 0, 0, 0).getTime(), new Date(y, m - 1, d, 23, 59, 59, 999).getTime()]; }
function addDaysISO(iso, n) { const [y, m, d] = iso.split("-").map(Number); return isoOf(new Date(y, m - 1, d + n)); }
function daysBetween(fromISO, toISO) { const [y1, m1, d1] = fromISO.split("-").map(Number); const [y2, m2, d2] = toISO.split("-").map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000); }
async function sha256Hex(s) { const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))); return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function randomPassword() { const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"; const a = new Uint8Array(10); crypto.getRandomValues(a); return "pv-" + [...a].map((x) => chars[x % chars.length]).join(""); }
const firstNameOf = (u) => { const n = (u && (u.name || u.email) || "").trim(); const f = n.split(/[\s@._-]+/)[0] || "there"; return f.charAt(0).toUpperCase() + f.slice(1); };
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const plural = (n, w, ws) => `${fmtInt(n)} ${n === 1 ? w : (ws || w + "s")}`;
const normKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f ? f(x) : x) || 0), 0);
const by = (arr, keyFn) => { const m = new Map(); arr.forEach((x) => { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
const mailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || "").trim());
const domainOk = (email) => { const e = String(email || "").toLowerCase(); const d = e.slice(e.lastIndexOf("@") + 1); return ALLOWED_DOMAINS.some((p) => domainMatches(p, d)); };

function downloadText(text, name, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿" + text], { type });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
/* a CSV from a header row and array rows (the Production layout the server builds) */
function arrayCSV(header, rows) {
  const esc = (v) => { let s = v == null ? "" : String(v); if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; };
  return [header.map(esc).join(",")].concat(rows.map((r) => r.map(esc).join(","))).join("\r\n");
}
function toCSV(rows, cols) {
  const esc = (v) => { let s = v == null ? "" : String(v); if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"'; return s; };
  return [cols.map((c) => esc(c.label)).join(",")].concat(rows.map((r) => cols.map((c) => esc(typeof c.get === "function" ? c.get(r) : r[c.key])).join(","))).join("\r\n");
}

/* ---------- date range: one picker for the whole app (Today, This week from Monday, This month, Custom) ---------- */
const RANGE_PRESETS = [["today", "Today"], ["week", "This week"], ["month", "This month"], ["custom", "Custom"]];
const weekStartISO = (iso) => addDaysISO(iso, -((new Date(iso + "T12:00:00").getDay() + 6) % 7));
const newRange = (key = "today") => ({ key, from: addDaysISO(todayISO(), -6), to: todayISO() });
function rangeSpan(r) {
  const t = todayISO();
  if (!r || r.key === "all") return null;
  if (r.key === "today") return [t, t];
  if (r.key === "week") return [weekStartISO(t), t];
  if (r.key === "month") return [t.slice(0, 8) + "01", t];
  const a = r.from || t, b = r.to || t; return a <= b ? [a, b] : [b, a];
}
function rangeText(r) {
  if (!r || r.key === "all") return "all time";
  if (r.key !== "custom") return { today: "today", week: "this week", month: "this month" }[r.key];
  const [a, b] = rangeSpan(r); return a === b ? fmtDate(a) : fmtDate(a) + " to " + fmtDate(b);
}
function DateRange({ value, onChange, allowAll, label = "Date range" }) {
  const t = todayISO();
  const pick = (k) => { const s = k === "custom" && value.key !== "custom" ? rangeSpan(value) || [addDaysISO(t, -6), t] : null; onChange({ ...value, key: k, ...(s ? { from: s[0], to: s[1] } : {}) }); };
  const body = <div className="drange"><div className="seg2">{[...(allowAll ? [["all", "All time"]] : []), ...RANGE_PRESETS].map(([k, l]) => <button key={k} type="button" className={value.key === k ? "on" : ""} onClick={() => pick(k)}>{l}</button>)}</div>
    {value.key === "custom" && <span className="drange-c"><input className="input" type="date" value={value.from} max={t} onChange={(e) => onChange({ ...value, from: e.target.value })} /><span className="muted small">to</span><input className="input" type="date" value={value.to} max={t} onChange={(e) => onChange({ ...value, to: e.target.value })} /></span>}</div>;
  return label ? <Field label={label}>{body}</Field> : body;
}

/* ---------- value parsing (from the Revenue Doctor) ---------- */
function parseMoney(v) {
  if (v == null) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).trim().toUpperCase();
  if (!s || /^(-+|N\/?A|#N\/A|NULL|NONE)$/.test(s)) return null;
  const neg = /\(.*\)/.test(s) || /^-|^\$\s*-|-$/.test(s) || /\bCR$/.test(s);
  const n = parseFloat(s.replace(/\b(CR|DR)$/, "").replace(/[^0-9.]/g, ""));
  if (isNaN(n)) return null;
  return neg ? -n : n;
}
function excelSerialToISO(n) { return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10); }
function parseDateAny(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return isNaN(v) ? "" : isoOf(v);
  if (typeof v === "number") return v > 20000 && v < 90000 ? excelSerialToISO(v) : "";
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d{5}(\.\d+)?$/.test(s)) { const n = Number(s); return n > 20000 && n < 90000 ? excelSerialToISO(n) : ""; }
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let mo = +m[1], da = +m[2], yr = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (mo > 12 && da <= 12) { const t = mo; mo = da; da = t; }
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31 && yr > 1990 && yr < 2100) return `${yr}-${pad2(mo)}-${pad2(da)}`;
    return "";
  }
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  const t = Date.parse(s);
  if (isNaN(t)) return "";
  const d = new Date(t);
  if (d.getFullYear() < 2000 || d.getFullYear() > 2100) return "";
  return isoOf(d);
}

/* ---------- reading spreadsheets ---------- */
function readWorkbook(buffer, fileName) {
  const isText = /\.(csv|txt|tsv)$/i.test(fileName || "");
  const wb = isText ? XLSX.read(new TextDecoder("utf-8").decode(buffer), { type: "string", cellDates: false }) : XLSX.read(buffer, { type: "array", cellDates: false });
  return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" }) })).filter((s) => s.rows.length);
}
function detectHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i] || [];
    const cells = r.filter((c) => String(c).trim() !== "");
    if (cells.length >= 3 && cells.filter((c) => typeof c === "string" && /[a-zA-Z]/.test(c)).length >= Math.ceil(cells.length * 0.6)) return i;
  }
  return 0;
}
function tableFromSheet(rows) {
  const hi = detectHeaderRow(rows);
  const seen = {};
  const headers = (rows[hi] || []).map((h, i) => { let t = String(h).trim() || `Column ${i + 1}`; seen[t] = (seen[t] || 0) + 1; if (seen[t] > 1) t = `${t} (${seen[t]})`; return t; });
  const data = rows.slice(hi + 1).filter((r) => r && r.some((c) => String(c).trim() !== "")).map((r) => { const o = {}; headers.forEach((h, i) => { o[h] = r[i] == null ? "" : r[i]; }); return o; });
  return { headers, rows: data, headerRow: hi };
}
function tableFromObjects(objs) { const headers = Object.keys(objs[0] || {}); return { headers, rows: objs, headerRow: 0 }; }

/* ---------- column mapping ---------- */
const FIELDS = [
  { key: "claim_no", label: "Claim # / Charge ID", hint: "matches the same claim across uploads" },
  { key: "account_no", label: "Account # / MRN" },
  { key: "patient", label: "Patient name" },
  { key: "payer", label: "Payer / Insurance" },
  { key: "dos", label: "Date of service", type: "date" },
  { key: "cpt", label: "CPT / Procedure" },
  { key: "provider", label: "Provider" },
  { key: "billed", label: "Billed / Charge amount", type: "money" },
  { key: "balance", label: "Balance (AR)", type: "money", hint: "drives value tiers and priority" },
  { key: "status", label: "Status" },
  { key: "sub_status", label: "Sub status / Denial reason" },
  { key: "action", label: "Action (from file)" },
  { key: "comments", label: "Comments / Notes" },
  { key: "date_worked", label: "Date worked", type: "date", worked: true },
  { key: "follow_up", label: "Follow-up date", type: "date", worked: true },
  { key: "file_bucket", label: "Aging bucket (from file)" },
  { key: "location", label: "Location (from file)", hint: "optional: split one file across locations" },
];
const normHeader = (h) => String(h || "").replace(/^﻿/, "").toLowerCase().replace(/#/g, " number ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const HEADER_RULES = {
  claim_no: [["ig claim id number charge id number", "claim id", "claim number", "claim no", "claim num", "claimid", "claim ref", "claim reference", "claim control number", "icn", "tcn", "charge id", "encounter id", "encounter number", "invoice number", "invoice no", "claim"], ["invoice", "encounter", "charge id"]],
  account_no: [["account number", "account no", "acct number", "acct no", "account", "acct", "mrn", "patient id", "patient account", "patient account number", "chart number", "medical record number", "account id"], ["chart", "record"]],
  patient: [["patient name", "patient", "pt name", "patient full name", "member name", "guarantor", "guarantor name"], ["name"]],
  payer: [["payer", "payer name", "payor", "payor name", "insurance", "insurance name", "insurance company", "carrier", "primary insurance", "primary payer", "plan name", "financial class", "ins"], ["plan"]],
  dos: [["date of service", "dos", "service date", "svc date", "dos from", "from date", "date of svc", "encounter date", "visit date", "from dos"], []],
  cpt: [["cpt", "cpt code", "cpt codes", "procedure", "procedure code", "procedure codes", "proc code", "hcpcs", "cpt hcpcs", "service code"], []],
  provider: [["provider", "provider name", "rendering provider", "servicing provider", "doctor", "physician", "clinician", "billing provider"], ["rendering"]],
  billed: [["billed amount", "billed amt", "billed", "charge amount", "charge amt", "charges", "total charge", "total charges", "billed charges", "total billed", "amount billed", "claim amount", "charge"], []],
  balance: [["balance amount", "balance amt", "balance", "outstanding", "outstanding balance", "ar balance", "open balance", "amount due", "balance due", "insurance balance", "ins balance", "total balance", "current balance", "remaining balance", "ar amount", "amount"], []],
  status: [["status", "claim status", "current status", "claim state", "ar status"], []],
  sub_status: [["sub status", "substatus", "denial reason", "denial code", "carc", "reason code", "rejection reason", "remark", "reason"], []],
  action: [["action", "next action", "action item", "follow up action", "next step", "ar action", "action taken"], []],
  comments: [["comments notes", "comments", "notes", "comment", "note", "remarks", "ar notes", "last note"], []],
  date_worked: [["date worked", "date of work", "work date", "worked date", "dow", "dateworked", "last worked", "last worked on", "last touch", "last touched", "last action date"], []],
  follow_up: [["follow up date", "followup date", "next follow up", "next follow up date", "follow up", "next action date", "tickler", "review date", "fu date"], []],
  file_bucket: [["bucket responsibility", "bucket", "aging bucket", "age bucket", "aging", "ar bucket", "age"], []],
  location: [["location", "location name", "facility", "site", "practice location", "office", "service location"], []],
};
function autoMap(headers) {
  const normed = headers.map((h) => ({ h, n: normHeader(h) }));
  const used = new Set();
  const map = {};
  const claim = (f, hit) => { if (hit && !used.has(hit.h)) { map[f] = hit.h; used.add(hit.h); return true; } return false; };
  for (const f of FIELDS) { // pass 1: exact names
    const names = (HEADER_RULES[f.key] || [[], []])[0];
    const hit = normed.find((x) => !used.has(x.h) && names.includes(x.n));
    claim(f.key, hit);
  }
  for (const f of FIELDS) { // pass 2: header contains a confident name
    if (map[f.key]) continue;
    const names = (HEADER_RULES[f.key] || [[], []])[0].filter((n) => n.length >= 4);
    const hit = normed.find((x) => !used.has(x.h) && names.some((n) => x.n === n || x.n.split(" ").join(" ").includes(n)));
    claim(f.key, hit);
  }
  for (const f of FIELDS) { // pass 3: generic words
    if (map[f.key]) continue;
    const names = (HEADER_RULES[f.key] || [[], []])[1];
    const hit = normed.find((x) => !used.has(x.h) && names.some((n) => x.n.includes(n)));
    claim(f.key, hit);
  }
  return map;
}

/* ---------- the Revenue Doctor's prioritisation rules ---------- */
const BUCKETS = [["0–30", 0, 30], ["31–60", 31, 60], ["61–90", 61, 90], ["91–120", 91, 120], ["120+", 121, 99999]];
const BUCKET_ORDER = BUCKETS.map((b) => b[0]);
const bucketOf = (age) => (age == null ? "" : (BUCKETS.find(([, lo, hi]) => age >= lo && age <= hi) || BUCKETS[4])[0]);
const UNBILLED_RE = /missing\s?claim|no\s?claim|unbilled|not\s?billed|un-?submitted/i;
const STATUS_MAP = [
  { key: "partial", test: /partial|underpaid|short\s*paid|under\s*paid/i },
  { key: "denied", test: /\bden|under\s*appeal|appeal/i },
  { key: "rejected", test: /reject|resubmit|corrected/i },
  { key: "patient", test: /patient\s*resp|self\s*pay|pt\s*resp|patient\s*bal|patient_responsibility|deductible|copay|co-?insurance|\bpr\b/i },
  { key: "secondary", test: /secondary/i },
  { key: "awaiting", test: /await|pending|process|in\s*process|submitted|payer|delay|no\s*claim\s*on\s*file|not\s*on\s*file|\bnof\b/i },
  { key: "paid", test: /paid|closed|settled|adjusted\s*off|zero\s*balance/i },
];
const STATUS_LABEL = { rejected: "Rejected", denied: "Denied", partial: "Partially paid", secondary: "Awaiting secondary", awaiting: "Awaiting payer", patient: "Patient responsibility", paid: "Paid / closed", other: "Other", unknown: "No status" };
const STATUS_ORDER = ["rejected", "denied", "partial", "secondary", "awaiting", "other", "unknown", "patient", "paid"];
const STATUS_PTS = { rejected: 100, denied: 90, partial: 75, secondary: 65, awaiting: 50, other: 40, unknown: 40, patient: 20, paid: 0 };
const STATUS_ACTION = { rejected: "correct and resubmit before the filing limit", denied: "review the reason, confirm the appeal limit, appeal with documentation", partial: "compare paid vs allowed, appeal the underpayment", secondary: "file to secondary with the primary EOB", awaiting: "check portal or call, escalate past normal turnaround", patient: "move to patient statements per policy", other: "review and decide the next step", unknown: "check claim status with the payer" };
function classifyOne(s) { const v = String(s || "").trim(); if (!v) return null; for (const b of STATUS_MAP) if (b.test.test(v)) return b.key; return "other"; }
function classifyStatus({ sub_status, status, action, file_bucket }) {
  const cands = [sub_status, status, action, file_bucket].map(classifyOne);
  const firm = cands.find((k) => k && k !== "other");
  if (firm) return firm;
  return cands.some((k) => k === "other") ? "other" : "unknown";
}
function urgencyOf(age) {
  if (age == null) return { pts: 5, label: "no date of service" };
  if (age >= 361) return { pts: 25, label: "360+ days: confirm appeal limit first" };
  if (age >= 121) return { pts: 30, label: "aged, appeal-eligible" };
  if (age >= 91) return { pts: 35, label: "past 90-day window: appeal soon" };
  if (age >= 75) return { pts: 45, label: "near timely filing limit" };
  if (age >= 61) return { pts: 20, label: "" };
  if (age >= 31) return { pts: 10, label: "" };
  return { pts: 0, label: "" };
}
const TIER_LOW = 100;
function tierCut(claims) { const open = claims.filter((c) => c.balance > 0); const avg = open.length ? sum(open, (c) => c.balance) / open.length : 0; return { low: TIER_LOW, high: Math.max(avg, TIER_LOW), avg }; }
const tierOf = (bal, cut) => (bal < cut.low ? "Low" : bal <= cut.high ? "Medium" : "High");
const TIER_PTS = { High: 30, Medium: 15, Low: 0 };
/* TFL / AFL deadlines in the score. The TFL counts while the payer has not accepted the claim (days from DOS); the AFL once it is denied
   or underpaid (days from the denial / EOB date). When a limit is known its real deadline replaces the age guess. Keep the classes in step with worker.js. */
const TFL_CLASSES = ["rejected", "awaiting", "secondary", "other", "unknown"], AFL_CLASSES = ["denied", "partial"];
function deadlinePts(left, what) {
  if (left == null) return null;
  if (left < 0) return { pts: what === "TFL" ? 5 : 0, label: what === "TFL" ? `past TFL by ${-left}d: needs proof of timely filing` : `past appeal limit by ${-left}d` };
  if (left <= 7) return { pts: 80, label: `${what} in ${left}d: act now` };
  if (left <= 15) return { pts: 65, label: `${what} in ${left}d` };
  if (left <= 30) return { pts: 50, label: `${what} in ${left}d` };
  if (left <= 60) return { pts: 25, label: `${what} in ${left}d` };
  return { pts: 0, label: `${what} in ${left}d` };
}
function deadlineOf(c, today) {
  const cls = c.status_class || "unknown";
  const t = today || todayISO();
  const days = (from, n) => (n && /^\d{4}-\d{2}-\d{2}$/.test(from || "") ? daysBetween(t, addDaysISO(from, n)) : null);
  if (AFL_CLASSES.includes(cls) && c.afl_days && c.denial_date) return deadlinePts(days(c.denial_date, c.afl_days), "AFL");
  if (TFL_CLASSES.includes(cls) && c.tfl_days && c.dos) return deadlinePts(days(c.dos, c.tfl_days), "TFL");
  return null;
}
function scoreClaim(c, today) {
  const age = c.age_days;
  const dl = deadlineOf(c, today);
  const urg = dl || urgencyOf(age);
  const cls = c.status_class || "unknown";
  const tier = c.tier || "Medium";
  const bal = Number(c.balance) || 0;
  let pts = (STATUS_PTS[cls] ?? 40) + urg.pts + (TIER_PTS[tier] || 0) + Math.min(25, Math.log10(Math.max(0, bal) + 1) * 6);
  let fu = "";
  if (c.follow_up_on && today) {
    const over = daysBetween(c.follow_up_on, today);
    if (over >= 15) { pts += 25; fu = "follow-up overdue " + over + "d"; }
    else if (over >= 0) { pts += 15; fu = "follow-up due"; }
    else fu = "follow-up " + fmtDate(c.follow_up_on);
  } else if (c.worked_before) fu = "worked before";
  pts -= 5 * (Number(c.skips) || 0);
  if (c.escalated) pts += 10;
  if (tier === "Low") pts *= 0.5;
  const parts = [STATUS_LABEL[cls] || cls, age == null ? "no DOS" : `${age}d (${bucketOf(age)})`, urg.label, `${tier} value ${fmtMoney(bal)}`, fu].filter(Boolean);
  return { priority: Math.round(pts * 10) / 10, reason: parts.join(" · "), urgency: urg };
}
/* Priority set by a team lead (Claims tab). Keep in step with PRIORITY_LEVELS in worker.js. */
const PRIORITY_LEVELS_UI = { top: { label: "Top: work first", add: 200, mul: 1, short: "⇈ Top" }, high: { label: "Raised", add: 60, mul: 1, short: "↑ Raised" }, low: { label: "Lowered", add: 0, mul: 0.3, short: "↓ Lowered" } };
const applyLevelUI = (base, level) => { const l = PRIORITY_LEVELS_UI[level]; return l ? Math.round(((Number(base) || 0) * l.mul + l.add) * 10) / 10 : Number(base) || 0; };
const PRIORITY_WHY = ["Client asked for it", "Near / past timely filing (TFL)", "Appeal deadline (AFL)", "High dollar / big balance", "Payer issue: work with the payer's other claims", "Patient call back / complaint", "Escalation or audit follow-up", "Waiting on client / documents", "Not workable yet (hold)", "Score was wrong for this claim", "Other"];
/* Re-age and re-score a set of claims as of today (used before allocation). */
function rescore(claims, today) {
  const cut = tierCut(claims);
  return claims.map((c) => {
    const age = c.dos ? Math.max(0, daysBetween(c.dos, today)) : null;
    const n = { ...c, age_days: age, bucket: bucketOf(age), tier: tierOf(Number(c.balance) || 0, cut) };
    const s = scoreClaim(n, today);
    n.priority = s.priority; n.priority_reason = s.reason;
    // A team lead's setting goes on top of the automatic score; the server applies it again when the plan is saved, so it is sent without it.
    n.priority_auto = s.priority; n.priority_reason_auto = s.reason;
    if (PRIORITY_LEVELS_UI[c.priority_set]) { n.priority = applyLevelUI(s.priority, c.priority_set); n.priority_reason = (c.priority_set_label || PRIORITY_LEVELS_UI[c.priority_set].label) + " · " + s.reason; }
    return n;
  });
}

/* ---------- building claims from a mapped file ---------- */
function compactRaw(r) {
  const out = {}; let n = 0;
  for (const k in r) { if (n++ >= 60) break; const v = r[k]; if (v === "" || v == null) continue; out[k] = String(v).slice(0, 200); }
  return out;
}
function buildClaims({ rows, mapping, kind, today }) {
  const get = (r, f) => (mapping[f] ? r[mapping[f]] : "");
  const txt = (v) => (v == null ? "" : String(v).trim());
  const first = (lines, f) => (lines.find((l) => l[f]) || {})[f] || "";
  const hasBalance = !!mapping.balance;
  const groups = new Map();
  let footer = 0, blank = 0;
  rows.forEach((r, i) => {
    const claim_no = txt(get(r, "claim_no")), patient = txt(get(r, "patient")), dos = parseDateAny(get(r, "dos")), payer = txt(get(r, "payer"));
    if (!claim_no && !patient && !dos) { blank++; return; }
    if (/^\s*(grand\s*|sub\s*)?totals?\b/i.test(claim_no) || /^\s*(grand\s*|sub\s*)?totals?\b/i.test(patient) || /^\s*(grand\s*|sub\s*)?totals?\b/i.test(payer)) { footer++; return; }
    const line = {
      claim_no, patient, dos, payer, account_no: txt(get(r, "account_no")), cpt: txt(get(r, "cpt")), provider: txt(get(r, "provider")),
      billed: mapping.billed ? parseMoney(get(r, "billed")) : null, balance: hasBalance ? parseMoney(get(r, "balance")) : null,
      status: txt(get(r, "status")), sub_status: txt(get(r, "sub_status")), action: txt(get(r, "action")), comments: txt(get(r, "comments")),
      date_worked: parseDateAny(get(r, "date_worked")), follow_up: parseDateAny(get(r, "follow_up")), file_bucket: txt(get(r, "file_bucket")), location: txt(get(r, "location")), raw: r, idx: i,
    };
    const key = claim_no && /\d/.test(claim_no) ? "claim:" + claim_no.toLowerCase().replace(/\s+/g, "") : "fp:" + [patient, dos, payer, line.provider].map(normKey).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(line);
  });
  const claims = [];
  groups.forEach((lines, key) => {
    const f = lines[0];
    const bal = hasBalance ? Math.round(sum(lines, (l) => l.balance) * 100) / 100 : 0;
    const bil = mapping.billed ? Math.round(sum(lines, (l) => l.billed) * 100) / 100 : null;
    const dosMin = lines.map((l) => l.dos).filter(Boolean).sort()[0] || "";
    const cpts = [...new Set(lines.map((l) => l.cpt).filter(Boolean))];
    const comments = [...new Set(lines.map((l) => l.comments).filter(Boolean))].join(" | ");
    const texts = { sub_status: first(lines, "sub_status"), status: first(lines, "status"), action: first(lines, "action"), file_bucket: first(lines, "file_bucket") };
    const status_class = classifyStatus(texts);
    const age = dosMin ? Math.max(0, daysBetween(dosMin, today)) : null;
    let exclude = "";
    if (status_class === "paid") exclude = "closed";
    else if (hasBalance && bal < 0) exclude = "credit balance";
    else if (hasBalance && bal === 0) exclude = "zero balance";
    else if (UNBILLED_RE.test(f.payer) || UNBILLED_RE.test(texts.status)) exclude = "unbilled";
    claims.push({
      match_key: key, claim_no: f.claim_no, account_no: first(lines, "account_no"), patient: f.patient, payer: f.payer, dos: dosMin, cpt: cpts.join(", "), provider: first(lines, "provider"),
      billed: bil, balance: bal, lines: lines.length, lines_json: lines.map((l) => ({ cpt: l.cpt, dos: l.dos, balance: l.balance, billed: l.billed })),
      age_days: age, bucket: bucketOf(age), status_class, file_status: texts.status, file_sub_status: texts.sub_status, file_action: texts.action, file_comments: comments, file_bucket: texts.file_bucket,
      location: f.location, worked_before: kind === "worked" ? 1 : 0,
      last_worked_on: kind === "worked" ? (lines.map((l) => l.date_worked).filter(Boolean).sort().pop() || "") : "",
      follow_up_on: kind === "worked" ? (lines.map((l) => l.follow_up).filter(Boolean).sort().pop() || "") : "",
      exclude_reason: exclude, raw: compactRaw(f.raw),
    });
  });
  const included = claims.filter((c) => !c.exclude_reason);
  const cut = tierCut(included);
  claims.forEach((c) => { c.tier = tierOf(c.balance, cut); const s = scoreClaim(c, today); c.priority = s.priority; c.priority_reason = s.reason; });
  claims.sort((a, b) => b.priority - a.priority || b.balance - a.balance);
  const summary = summarizeClaims(claims, { footer, blank, rowsRead: rows.length, cut, hasBalance });
  return { claims, summary };
}
function summarizeClaims(claims, extra = {}) {
  const inc = claims.filter((c) => !c.exclude_reason);
  const count = (keyFn, order) => { const m = {}; inc.forEach((c) => { const k = keyFn(c) || "–"; m[k] = m[k] || { key: k, n: 0, amt: 0 }; m[k].n++; m[k].amt += c.balance; }); const arr = Object.values(m); return order ? arr.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : arr.sort((a, b) => b.amt - a.amt); };
  const excluded = {}; claims.filter((c) => c.exclude_reason).forEach((c) => { excluded[c.exclude_reason] = excluded[c.exclude_reason] || { n: 0, amt: 0 }; excluded[c.exclude_reason].n++; excluded[c.exclude_reason].amt += c.balance; });
  const pts = {}; inc.forEach((c) => { const k = c.account_no || c.patient; if (!k) return; pts[k] = (pts[k] || 0) + 1; });
  const multi = Object.values(pts).filter((n) => n >= 3).length;
  return {
    ...extra, claims: claims.length, included: inc.length, amount: sum(inc, (c) => c.balance), excluded, linesRolled: sum(claims, (c) => c.lines) - claims.length,
    tiers: count((c) => c.tier, ["High", "Medium", "Low"]), buckets: count((c) => c.bucket, BUCKET_ORDER), classes: count((c) => c.status_class, STATUS_ORDER),
    payers: count((c) => c.payer).slice(0, 8), patientsWith3Plus: multi, workedBefore: inc.filter((c) => c.worked_before).length,
  };
}

/* ---------- allocation planner ----------
   Claims arrive sorted by priority. Each is handed to the team member who
   already owns its batch (same patient/account, else same payer), so one
   call covers many claims; otherwise to whoever has the most room. */
const STRATEGIES = [
  { key: "smart", label: "Smart batching (patient, then payer)", desc: "Keeps every claim of a patient with one person, and the rest grouped by payer, in priority order." },
  { key: "payer", label: "Payer batching", desc: "Groups by payer so each person calls fewer payers for more money." },
  { key: "patient", label: "Patient batching", desc: "Groups by patient / account so one touch resolves several claims." },
  { key: "round_robin", label: "Straight priority, round robin", desc: "Top priority first, dealt evenly across the team. No batching." },
  { key: "even_dollars", label: "Balance the dollars", desc: "Each claim goes to whoever holds the least AR so far." },
];
function planAllocation({ claims, users, strategy }) {
  const sorted = [...claims].sort((a, b) => b.priority - a.priority || b.balance - a.balance);
  const patientCount = {};
  sorted.forEach((c) => { const k = c.account_no || c.patient; if (k) patientCount[k] = (patientCount[k] || 0) + 1; });
  const keyOf = (c) => {
    const pk = c.account_no || c.patient;
    if (strategy === "patient") return pk ? "a:" + normKey(pk) : "p:" + normKey(c.payer);
    if (strategy === "payer") return "p:" + normKey(c.payer || "unknown");
    if (strategy === "smart") return pk && patientCount[pk] >= 2 ? "a:" + normKey(pk) : "p:" + normKey(c.payer || "unknown");
    return null;
  };
  const team = users.filter((u) => u.capacity > 0).map((u) => ({ id: u.id, name: u.name, capacity: u.capacity, left: u.capacity, count: 0, amt: 0, keys: new Set(), payers: {}, claims: [] }));
  const owners = new Map();
  let rr = 0;
  const assignments = [], leftover = [];
  const pick = () => {
    const open = team.filter((t) => t.left > 0);
    if (!open.length) return null;
    if (strategy === "round_robin") { for (let i = 0; i < team.length; i++) { const t = team[(rr + i) % team.length]; if (t.left > 0) { rr = (rr + i + 1) % team.length; return t; } } return open[0]; }
    if (strategy === "even_dollars") return open.sort((a, b) => a.amt - b.amt || b.left - a.left)[0];
    return open.sort((a, b) => b.left - a.left || a.count - b.count)[0];
  };
  for (const c of sorted) {
    const key = keyOf(c);
    let t = key ? owners.get(key) : null;
    if (t && t.left <= 0) t = null;
    if (!t) { t = pick(); if (!t) { leftover.push(c); continue; } if (key) owners.set(key, t); }
    t.left--; t.count++; t.amt += Number(c.balance) || 0; if (key) t.keys.add(key); t.payers[c.payer || "Unknown"] = (t.payers[c.payer || "Unknown"] || 0) + 1; t.claims.push(c);
    assignments.push({ id: c.id, user_id: t.id, priority: c.priority_auto ?? c.priority, priority_reason: c.priority_reason_auto ?? c.priority_reason, tier: c.tier, bucket: c.bucket, age_days: c.age_days });
  }
  const perUser = team.map((t) => ({ id: t.id, name: t.name, capacity: t.capacity, count: t.count, amt: t.amt, batches: t.keys.size, topPayers: Object.entries(t.payers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, n]) => `${p} (${n})`), high: t.claims.filter((c) => c.tier === "High").length, urgent: t.claims.filter((c) => (c.age_days || 0) >= 75 && (c.age_days || 0) <= 120).length }));
  return { assignments, perUser, leftover: leftover.length, leftoverAmt: sum(leftover, (c) => c.balance) };
}

/* ---------- sample inventory (synthetic, no real patients) ---------- */
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeSampleRows({ kind = "fresh", seed = 7, count = 160, today = todayISO() } = {}) {
  const rnd = mulberry32(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const FIRST = ["Maria", "James", "Linda", "Robert", "Patricia", "Michael", "Jennifer", "William", "Elizabeth", "David", "Susan", "Richard", "Karen", "Joseph", "Nancy", "Thomas", "Lisa", "Daniel", "Sandra", "Paul", "Ashley", "Kevin", "Donna", "Brian"];
  const LAST = ["Garcia", "Smith", "Johnson", "Brown", "Martinez", "Davis", "Lopez", "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Lee", "Perez", "White", "Harris", "Clark", "Lewis", "Walker"];
  const PAYERS = ["Aetna", "UnitedHealthcare", "BCBS of Texas", "Medicare Part B", "Cigna", "Humana", "Texas Medicaid", "VSP", "EyeMed", "Tricare"];
  const CPTS = ["92004", "92014", "92015", "92134", "92250", "99213", "99214", "65855", "66984", "92083", "92132"];
  const PROV = ["Dr. A. Patel", "Dr. S. Nguyen", "Dr. R. Okafor"];
  const STATUSES = [["Denied", "TFL - Timely filing", "Appeal"], ["Denied", "Auth required", "Obtain auth"], ["Denied", "Eligibility - coverage terminated", "Verify eligibility"], ["Denied", "COB - other payer primary", "Update COB"], ["Denied", "Non covered service", "Bill patient"], ["Denied", "Medical necessity", "Appeal with records"], ["Denied", "Bundled / inclusive", "Review coding"], ["Rejected", "Invalid member ID", "Correct & resubmit"], ["Pending", "In process", "Follow up"], ["Pending", "Claim not on file", "Resubmit"], ["Pending", "Awaiting secondary", "Bill secondary"], ["Partial payment", "Underpaid per contract", "Appeal underpayment"], ["Patient responsibility", "Deductible", "Patient statement"], ["Paid", "Paid in full", "Close"]];
  const patients = Array.from({ length: Math.round(count * 0.55) }, (_, i) => ({ name: `${pick(LAST)}, ${pick(FIRST)}`, acct: "A" + String(10400 + i) }));
  const rows = [];
  let claimNo = 7700010 + seed * 1000;
  for (let i = 0; i < count; i++) {
    const p = rnd() < 0.3 ? patients[Math.floor(rnd() * 12)] : pick(patients); // a few patients carry many claims
    const age = Math.floor(rnd() < 0.15 ? 150 + rnd() * 300 : 8 + rnd() * 130);
    const dos = addDaysISO(today, -age);
    const st = pick(STATUSES);
    const base = rnd() < 0.2 ? 20 + rnd() * 80 : 90 + rnd() * (rnd() < 0.25 ? 3200 : 600);
    const lines = rnd() < 0.25 ? 2 : 1;
    const id = String(claimNo++);
    for (let l = 0; l < lines; l++) {
      const bal = Math.round((base / lines) * 100) / 100;
      const r = {
        "IG Claim ID#/Charge ID#": id, "Account #": p.acct, "Patient Name": p.name, "Payer": pick(PAYERS), "DOS": `${dos.slice(5, 7)}/${dos.slice(8, 10)}/${dos.slice(0, 4)}`,
        "CPT": pick(CPTS), "Provider": pick(PROV), "Billed Amount($)": Math.round(bal * 1.6), "Balance Amount($)": st[0] === "Paid" ? 0 : bal,
        "Bucket / Responsibility": bucketOf(age), "Status": st[0], "Sub Status": st[1], "Action": st[2], "Comments/Notes": "",
      };
      if (kind === "worked") {
        const workedAgo = Math.floor(5 + rnd() * 50);
        const dw = addDaysISO(today, -workedAgo);
        r["Date Worked"] = `${dw.slice(5, 7)}/${dw.slice(8, 10)}/${dw.slice(0, 4)}`;
        r["Comments/Notes"] = `${dw}: Called ${r["Payer"]} ref#${Math.floor(rnd() * 9e6)}. ${st[1]}. ${st[2]} - follow up in 30 days.`;
      }
      rows.push(r);
    }
  }
  return rows;
}


/* ====================================================================
   PART 2 — transport, session, shared UI, sign in
   ==================================================================== */
const TOKEN_KEY = "brahmastra2:token";
let TOKEN = null; try { TOKEN = localStorage.getItem(TOKEN_KEY); } catch (e) {}
function setToken(t) { TOKEN = t || null; try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
const DEMO_SUPERVISOR = { email: "supervisor@purview-healthcare.com", password: "brahmastra-demo" };
const DEMO_USERS = [["aisha@purview-healthcare.com", "Aisha Verma"], ["rohan@purview-healthcare.com", "Rohan Mehta"], ["priya@purview-healthcare.com", "Priya Nair"]];

let localBackendPromise = null;
function getLocalBackend() {
  if (!localBackendPromise) localBackendPromise = (async () => {
    if (location.protocol === "file:") throw new Error("Demo mode needs a web address: open the app through GitHub Pages, Cloudflare Pages or dev\\serve.ps1 (http://localhost:8787), not as a file.");
    const [lib, worker] = await Promise.all([import(new URL("lib/local-backend.js", document.baseURI).href), import(new URL("worker.js", document.baseURI).href)]);
    return lib.createLocalBackend({ worker: worker.default, env: { DEMO: true, ADMIN_EMAILS: DEMO_SUPERVISOR.email, BOOTSTRAP_EMAIL: DEMO_SUPERVISOR.email, BOOTSTRAP_PASSWORD: DEMO_SUPERVISOR.password, ALLOWED_DOMAINS: ALLOWED_DOMAINS.join(",") } });
  })().catch((e) => { localBackendPromise = null; throw e; });
  return localBackendPromise;
}
async function rpc(op, payload = {}) {
  const body = JSON.stringify({ op, payload: { today: todayISO(), tz_offset_min: -new Date().getTimezoneOffset(), ...payload } });
  const init = { method: "POST", headers: { "Content-Type": "application/json", ...(TOKEN ? { Authorization: "Bearer " + TOKEN } : {}) }, body };
  let res;
  try { res = DEMO ? await (await getLocalBackend()).fetch("https://demo.brahmastra.local/api", init) : await fetch(API_BASE + "/api", init); }
  catch (e) { throw new Error(DEMO ? (e.message || "The demo backend could not start.") : "Could not reach the server. Check your connection and try again."); }
  let data = null; try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    if (res.status === 401 && TOKEN) signedOut();
    const err = new Error((data && data.error) || `Request failed (${res.status}).`); err.status = res.status; throw err;
  }
  notePhi(data);
  return data || {};
}
/* Patient names, account and member numbers this page has been sent, so a feedback screenshot can cover them
   (kept in memory only, never stored). */
const PHI_SEEN = new Set();
const PHI_KEY = /^(patient|patient_name|account_no|member_id|subscriber_id|dob|patient_dob)$/i;
const PHI_HEAD = /patient|member|subscriber|\bdob\b|birth|account ?(no|#|number)?$|acct|ssn|address|phone|guarantor|insured/i;
function addPhi(v) {
  const t = String(v == null ? "" : v).trim();
  if (t.length < 3 || /^(n\/a|none|unknown|-+)$/i.test(t)) return;
  if (PHI_SEEN.size > 30000) { const it = PHI_SEEN.values(); for (let i = 0; i < 5000; i++) PHI_SEEN.delete(it.next().value); }
  PHI_SEEN.add(t);
}
function notePhi(o, depth = 0) {
  if (!o || depth > 5 || typeof o !== "object") return;
  if (Array.isArray(o)) { for (let i = 0; i < Math.min(o.length, 5000); i++) notePhi(o[i], depth + 1); return; }
  if (Array.isArray(o.header) && Array.isArray(o.rows)) {
    const idx = o.header.map((h, i) => (PHI_HEAD.test(String(h)) ? i : -1)).filter((i) => i >= 0);
    for (const r of o.rows.slice(0, 20000)) if (Array.isArray(r)) idx.forEach((i) => addPhi(r[i]));
  }
  for (const k in o) { const v = o[k]; if (typeof v === "string" || typeof v === "number") { if (PHI_KEY.test(k)) addPhi(v); } else if (v && typeof v === "object") notePhi(v, depth + 1); }
}
/* Covers patient details in a cloned page before it is drawn: every known patient name / account / member number,
   and every table column whose heading looks like patient data. */
function maskPhi(doc) {
  try {
    const cover = (el) => { el.style.color = "transparent"; el.style.background = "#A9B4BF"; el.style.borderRadius = "3px"; el.querySelectorAll("*").forEach((c) => { c.style.color = "transparent"; c.style.background = "transparent"; }); };
    doc.querySelectorAll("table").forEach((t) => {
      const heads = [...t.querySelectorAll("thead th, tr:first-child th")].map((th) => (th.textContent || "").trim());
      const idx = heads.map((h, i) => (PHI_HEAD.test(h) ? i : -1)).filter((i) => i >= 0);
      if (idx.length) t.querySelectorAll("tbody tr").forEach((tr) => idx.forEach((i) => { const td = tr.children[i]; if (td) cover(td); }));
    });
    doc.querySelectorAll(".phi").forEach(cover);
    const list = [...PHI_SEEN].filter((x) => x.length >= 3).sort((a, b) => b.length - a.length).slice(0, 25000);
    if (!list.length) return;
    const re = new RegExp(list.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    const walk = doc.createTreeWalker(doc.body, 4);
    const nodes = []; for (let n = walk.nextNode(); n; n = walk.nextNode()) nodes.push(n);
    for (const n of nodes) { const v = n.nodeValue; if (v && v.trim().length >= 3) { re.lastIndex = 0; if (re.test(v)) { re.lastIndex = 0; n.nodeValue = v.replace(re, (m) => "█".repeat(Math.min(m.length, 18))); } } }
    doc.querySelectorAll("input, textarea").forEach((i) => { if (i.value && list.some((x) => i.value.includes(x))) i.value = "█".repeat(Math.min(i.value.length, 18)); });
  } catch (e) {}
}
function signedOut() { setToken(null); try { localStorage.removeItem("drishti:token:v1"); } catch (e) {} try { window.dispatchEvent(new CustomEvent("brahmastra:signedout")); } catch (e) {} }

/* Upload mapped claims in chunks; the first chunk opens the batch. */
async function uploadClaims({ client_id, location_id, kind, file_name, claims, summary, rows_read, source, web_url, onProgress }) {
  const totals = { inserted: 0, updated: 0, reopened: 0, closed: 0, excluded: 0, skipped: 0 };
  const parts = chunk(claims, 250);
  let batch_id = null;
  if (!parts.length) parts.push([]);
  for (let i = 0; i < parts.length; i++) {
    const r = await rpc("inventory.upload", { batch_id, client_id, location_id: location_id || null, kind, file_name, rows_read, source: source || "file", web_url: web_url || "", claims: parts[i], final: i === parts.length - 1, summary });
    batch_id = r.batch_id;
    for (const k in totals) totals[k] += r[k] || 0;
    if (onProgress) onProgress((i + 1) / parts.length);
  }
  return { batch_id, ...totals };
}

/* ---------- toasts ---------- */
const toastListeners = new Set();
function toast(msg, kind = "ok") { toastListeners.forEach((f) => f({ msg, kind, id: Date.now() })); }
function Toaster() {
  const [t, setT] = useState(null);
  useEffect(() => { const f = (x) => setT(x); toastListeners.add(f); return () => toastListeners.delete(f); }, []);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), t.kind === "err" ? 7000 : 3200); return () => clearTimeout(id); }, [t]);
  if (!t) return null;
  return <div className={"toast" + (t.kind === "err" ? " err" : "")} onClick={() => setT(null)}>{t.msg}</div>;
}

/* ---------- small shared pieces ---------- */
function Wordmark({ size = 22, tag = "claim allocation & follow-up" }) {
  return (
    <div className="wordmark">
      <img src={PURVIEW_MARK} alt="Purview Healthcare" style={{ height: Math.round(size * 1.62), width: "auto" }} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span className="t1">PURVIEW</span>
        <span className="t2" style={{ fontSize: size }}><span className="b">Brahm</span><span className="g">astra</span></span>
        {tag && <span className="t3">{tag}</span>}
      </div>
    </div>
  );
}
const Spinner = ({ label }) => <span className="muted small"><span className="spin" /> {label || "Working…"}</span>;
function Modal({ title, sub, onClose, children, wide, narrow, footer }) {
  useEffect(() => { const h = (e) => { if (e.key === "Escape" && onClose) onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
      <div className={"modal" + (wide ? " wide" : "") + (narrow ? " narrow" : "")}>
        <div className="row between top mb">
          <div><h2>{title}</h2>{sub && <div className="sub">{sub}</div>}</div>
          {onClose && <button className="btn sm" onClick={onClose}>Close</button>}
        </div>
        {children}
        {footer && <div className="row mt" style={{ justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}
function Confirm({ title, text, confirmLabel = "Confirm", danger, onYes, onNo, busy }) {
  return (
    <Modal title={title} onClose={onNo} narrow footer={<><button className="btn" onClick={onNo} disabled={busy}>Cancel</button><button className={"btn " + (danger ? "danger" : "primary")} onClick={onYes} disabled={busy}>{busy ? "Working…" : confirmLabel}</button></>}>
      <div>{text}</div>
    </Modal>
  );
}
const Field = ({ label, children, hint, style }) => (
  <label className="field" style={style}><span>{label}</span>{children}{hint && <span className="tiny muted" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{hint}</span>}</label>
);
const Kpi = ({ label, value, sub, tone, onClick }) => (
  <div className={"kpi" + (tone ? " " + tone : "")} onClick={onClick} style={onClick ? { cursor: "pointer" } : undefined}>
    <div className="l">{label}</div><div className="v">{value}</div>{sub && <div className="s">{sub}</div>}
  </div>
);
const STATE_META = { open: ["gray", "Open"], assigned: ["blue", "Assigned"], in_progress: ["amber", "In progress"], completed: ["teal", "Worked"], in_process: ["purple", "In process"], closed: ["green", "Closed"], excluded: ["red", "Excluded"] };
const StateBadge = ({ state }) => { const m = STATE_META[state] || ["gray", state]; return <span className={"badge " + m[0]}>{m[1]}</span>; };
const TierBadge = ({ tier }) => <span className={"badge " + (tier === "High" ? "red" : tier === "Medium" ? "teal" : "gray")}>{tier || "–"}</span>;
const CLASS_TONE = { rejected: "amber", denied: "red", partial: "amber", secondary: "teal", awaiting: "teal", patient: "gray", paid: "green", other: "gray", unknown: "gray" };
const ClassBadge = ({ cls }) => <span className={"badge " + (CLASS_TONE[cls] || "gray")}>{STATUS_LABEL[cls] || cls || "–"}</span>;
/* The shared posting / submission status: the same badge for the TL, the biller and the department. */
const HANDOFF_META = { with_posting: ["purple", "In process · Payment Posting"], posted: ["green", "Payment posted"], posting_assist: ["red", "Posting needs assistance from AR"],
  posting_back: ["amber", "Posting needs assistance from AR"], posting_client: ["amber", "Posting needs assistance from client"],
  with_submission: ["blue", "In process · Submission"], submitted: ["green", "Submitted · recheck in 48 h"], submission_assist: ["red", "Submission needs assistance from AR"],
  submission_back: ["amber", "Submission needs assistance from AR"], submission_client: ["amber", "Submission needs assistance from client"],
  submission_accepted: ["green", "Submission accepted · final check done"], submission_rejected: ["red", "Submission rejected"],
  with_rejection: ["red", "In process · Rejections"], rejection_assist: ["red", "Rejections needs assistance from AR"], rejection_back: ["amber", "Rejections needs assistance from AR"], rejection_client: ["amber", "Rejections needs assistance from client"] };
const HandoffBadge = ({ status, style }) => (status && HANDOFF_META[status] ? <span className={"badge " + HANDOFF_META[status][0]} style={{ marginLeft: 4, ...(style || {}) }}>{HANDOFF_META[status][1]}</span> : null);
const KindBadge = ({ claim }) => (claim.worked_before ? <span className="badge purple">worked before</span> : <span className="badge green">fresh</span>);
/* Horizontal bars. Hover shows the full figures; a click (when onClick is given) filters the dashboard to that slice, and isOn marks the active slice. */
function Bars({ rows, labelOf, valueOf, fmt = fmtMoney, subOf, onClick, isOn, countOf }) {
  const max = Math.max(1, ...rows.map((r) => valueOf(r)));
  const total = sum(rows, (r) => valueOf(r)) || 0;
  const totalN = countOf ? sum(rows, (r) => countOf(r) || 0) : 0;
  const tip = (r) => { const v = valueOf(r); const pct = total ? Math.round(v / total * 100) : 0; const n = countOf ? countOf(r) : null; return `${labelOf(r)}\n${fmt(v)} · ${pct}% of the balance shown${n != null ? `\n${fmtInt(n)} claims · ${totalN ? Math.round(n / totalN * 100) : 0}% of the claims shown` : ""}${onClick ? "\nClick to filter the whole dashboard to this; click again to clear." : ""}`; };
  const anyOn = isOn && rows.some((r) => isOn(r));
  return (
    <div className="stack" style={{ gap: 6 }}>
      {rows.map((r, i) => { const on = isOn ? isOn(r) : false; return (
        <div key={i} className={"row" + (onClick ? " click" : "")} style={{ gap: 8, borderRadius: 6, cursor: onClick ? "pointer" : undefined, opacity: anyOn && !on ? 0.45 : 1, background: on ? "var(--soft)" : undefined, padding: on ? "2px 4px" : undefined }} title={tip(r)} onClick={onClick ? () => onClick(r) : undefined}>
          <div style={{ width: 140, fontSize: 12.5, fontWeight: 600, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{labelOf(r)}</div>
          <div className="bar" style={{ flex: 1 }}><i style={{ width: (valueOf(r) / max * 100) + "%" }} /></div>
          <div className="mono small" style={{ width: 86, textAlign: "right" }}>{fmt(valueOf(r))}</div>
          <div className="small muted" style={{ width: 44, textAlign: "right" }}>{total ? Math.round(valueOf(r) / total * 100) + "%" : ""}</div>
          {subOf && <div className="small muted" style={{ width: 70, textAlign: "right" }}>{subOf(r)}</div>}
        </div>); })}
      {!rows.length && <div className="muted small">Nothing yet.</div>}
    </div>
  );
}
function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return <div className="row" style={{ justifyContent: "flex-end" }}><span className="small muted">Page {page} of {pages}</span><button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button><button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div>;
}
const Empty = ({ children }) => <div className="empty">{children}</div>;
const ErrorBox = ({ error }) => (error ? <div className="alert err">{String(error)}</div> : null);
function useRpc(op, payload, deps = [], enabled = true) {
  const [state, setState] = useState({ data: null, error: null, loading: !!enabled });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) { setState({ data: null, error: null, loading: false }); return; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    rpc(op, payload).then((d) => alive && setState({ data: d, error: null, loading: false })).catch((e) => alive && setState({ data: null, error: e.message, loading: false }));
    return () => { alive = false; };
  }, [...deps, tick, enabled]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
/* A dropdown that works like a select with a search box inside: click it, type a few letters and the
   list narrows to them; click an option (or press Enter for the first match) to pick it; ✕ clears. */
function Combo({ value, options, onChange, placeholder, disabled, sm, width, clearable = true }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const qRef = useRef(null);
  useEffect(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; window.addEventListener("mousedown", h); return () => window.removeEventListener("mousedown", h); }, []);
  useEffect(() => { if (open) { setQ(""); const t = setTimeout(() => qRef.current && qRef.current.focus(), 0); return () => clearTimeout(t); } }, [open]);
  const val = String(value == null ? "" : value);
  const sel = options.find((o) => String(o.id) === val);
  const needle = q.trim().toLowerCase();
  const shown = (needle ? options.filter((o) => (o.label + " " + (o.sub || "")).toLowerCase().includes(needle)) : options).slice(0, 300);
  const pick = (o) => { onChange(o.id); setOpen(false); };
  const searchable = options.length > 7;
  const kd = (e) => { if (e.key === "Escape") setOpen(false); else if (e.key === "Enter") { e.preventDefault(); if (open && shown.length) pick(shown[0]); } };
  return (
    <div className={"combo" + (sm ? " sm" : "")} ref={ref} style={width ? { width } : undefined}>
      <button type="button" className="combo-ctl" disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={kd}>
        <span className={"combo-val" + (sel && val !== "" ? "" : " ph")}>{sel ? sel.label : (placeholder || "Pick…")}</span>
        {clearable && val !== "" && !disabled && <span className="combo-x" title="Clear" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(""); setOpen(false); }}>✕</span>}
        <span className="combo-caret">▼</span>
      </button>
      {open && !disabled && (
        <div className="combo-list">
          {searchable && <input ref={qRef} className="input sm combo-q" placeholder="Type to search…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={kd} autoComplete="off" />}
          <div className="combo-opts">
            {shown.map((o) => <button key={String(o.id)} type="button" className={"combo-item" + (String(o.id) === val ? " on" : "")} onMouseDown={(e) => { e.preventDefault(); pick(o); }}>{o.label}{o.sub ? <span className="tiny muted"> · {o.sub}</span> : null}</button>)}
            {!shown.length && <div className="combo-empty muted small">No match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
/* Like Combo, but the options come from the claims this person can see (payers, providers, CPTs,
   patients, claim and account numbers), narrowed on the server as they type. Free text works too:
   press Enter, or pick the Use "..." line. */
function SuggestCombo({ value, onChange, field, extra, placeholder, sm, width }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState([]);
  const ref = useRef(null);
  const qRef = useRef(null);
  useEffect(() => { const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }; window.addEventListener("mousedown", h); return () => window.removeEventListener("mousedown", h); }, []);
  useEffect(() => { if (open) { setQ(""); const t = setTimeout(() => qRef.current && qRef.current.focus(), 0); return () => clearTimeout(t); } }, [open]);
  const extraKey = JSON.stringify(extra || {});
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => { rpc("claims.suggest", { field, q: q.trim(), ...(extra || {}) }).then((r) => { if (alive) setOpts(r.values || []); }).catch(() => {}); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, field, extraKey]);
  const pick = (v) => { onChange(v); setOpen(false); };
  const free = q.trim() && !opts.some((v) => v.toLowerCase() === q.trim().toLowerCase());
  const kd = (e) => { if (e.key === "Escape") setOpen(false); else if (e.key === "Enter") { e.preventDefault(); if (q.trim()) pick(opts[0] && !free ? opts[0] : q.trim()); else if (opts.length) pick(opts[0]); } };
  return (
    <div className={"combo" + (sm ? " sm" : "")} ref={ref} style={width ? { width } : undefined}>
      <button type="button" className="combo-ctl" onClick={() => setOpen(!open)} onKeyDown={kd}>
        <span className={"combo-val" + (value ? "" : " ph")}>{value || placeholder}</span>
        {!!value && <span className="combo-x" title="Clear" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onChange(""); setOpen(false); }}>✕</span>}
        <span className="combo-caret">▼</span>
      </button>
      {open && (
        <div className="combo-list">
          <input ref={qRef} className="input sm combo-q" placeholder={"Type to search…"} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={kd} autoComplete="off" />
          <div className="combo-opts">
            {free && <button type="button" className="combo-item" onMouseDown={(e) => { e.preventDefault(); pick(q.trim()); }}>Use "{q.trim()}"</button>}
            {opts.map((v) => <button key={v} type="button" className={"combo-item" + (v === value ? " on" : "")} onMouseDown={(e) => { e.preventDefault(); pick(v); }}>{v}</button>)}
            {!opts.length && !free && <div className="combo-empty muted small">{q.trim() ? "No match." : "Type a few letters…"}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
/* Click a column heading to sort the table by it; click again for the other direction. */
function cmpVals(a, b) { const na = a == null || a === ""; const nb = b == null || b === ""; if (na && nb) return 0; if (na) return 1; if (nb) return -1; if (typeof a === "number" && typeof b === "number") return a - b; return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }); }
function useTableSort(defKey, defDir) {
  const [s, setS] = useState({ key: defKey || null, dir: defDir || "asc" });
  const click = (k) => setS((x) => (x.key === k ? { key: k, dir: x.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));
  const Th = (k, label, cls) => <th key={k} className={"sort " + (cls || "")} title="Click to sort" onClick={() => click(k)}>{label}{s.key === k ? (s.dir === "asc" ? " ▲" : " ▼") : ""}</th>;
  const sortRows = (rows, getters = {}) => {
    if (!s.key) return rows;
    const g = getters[s.key] || ((r) => r[s.key]);
    const out = rows.map((r, i) => [r, i]).sort((x, y) => cmpVals(g(x[0]), g(y[0])) || x[1] - y[1]);
    if (s.dir === "desc") out.reverse();
    return out.map((x) => x[0]);
  };
  return { s, Th, sortRows };
}
function ClientPicker({ ctx, clientId, setClientId, locId, setLocId, allowAll, allLabel = "All clients" }) {
  const client = ctx.clients.find((c) => c.id === clientId);
  const opts = [...(allowAll ? [{ id: "", label: allLabel }] : []), ...ctx.clients.filter((c) => c.active || c.id === clientId).map((c) => ({ id: c.id, label: c.name + (c.code ? ` (${c.code})` : "") }))];
  return (
    <>
      <Field label="Client"><Combo value={clientId} options={opts} placeholder={allowAll ? allLabel : "Type the client's name…"} onChange={(v) => { setClientId(v); setLocId && setLocId(""); }} /></Field>
      {setLocId && <Field label="Location"><Combo value={locId} disabled={!client} placeholder="All locations" onChange={setLocId}
        options={[{ id: "", label: "All locations" }, ...((client ? client.locations : []).filter((l) => l.active || l.id === locId).map((l) => ({ id: l.id, label: l.name })))]} /></Field>}
    </>
  );
}

function LocationPicker({ ctx, clientId, locId, setLocId }) {
  const client = ctx.clients.find((c) => c.id === clientId);
  return (
    <Field label="Location"><Combo value={locId} disabled={!client} placeholder="All locations" onChange={setLocId}
      options={[{ id: "", label: "All locations" }, ...((client ? client.locations : []).filter((l) => l.active || l.id === locId).map((l) => ({ id: l.id, label: l.name })))]} /></Field>
  );
}

/* ---------- sign in ---------- */
async function seedDemo(setStatus) {
  setStatus("Signing in as the demo supervisor…");
  const r = await rpc("auth.login", { email: DEMO_SUPERVISOR.email, passHash: await sha256Hex(DEMO_SUPERVISOR.password) });
  setToken(r.token);
  setStatus("Creating the team, clients and locations…");
  const s = await rpc("demo.seed");
  const sunrise = s.clients[0], lake = s.clients[1];
  const today = todayISO();
  const load = async (client, loc, kind, seed, count, label) => {
    setStatus(`Loading ${label}…`);
    const t = tableFromObjects(makeSampleRows({ kind, seed, count, today }));
    const mapping = autoMap(t.headers);
    const { claims, summary } = buildClaims({ rows: t.rows, mapping, kind, today });
    return uploadClaims({ client_id: client.id, location_id: loc.id, kind, file_name: `sample-${kind}-${loc.name.toLowerCase().replace(/\s+/g, "-")}.xlsx`, claims, summary, rows_read: t.rows.length });
  };
  await load(sunrise, sunrise.locations[0], "fresh", 11, 170, "fresh inventory · Sunrise Eye Care · Downtown");
  await load(sunrise, sunrise.locations[1], "worked", 23, 90, "previously worked inventory · Sunrise Eye Care · Westside");
  await load(lake, lake.locations[0], "fresh", 37, 60, "fresh inventory · Lakeview Dental Group");
  setStatus("Allocating Sunrise claims to the team…");
  const el = await rpc("claims.eligible", { client_id: sunrise.id });
  const pool = rescore(el.claims, today);
  const plan = planAllocation({ claims: pool, users: s.users.map((u) => ({ ...u, capacity: 20 })), strategy: "smart" });
  for (const part of chunk(plan.assignments, 300)) await rpc("alloc.apply", { client_id: sunrise.id, strategy: "smart", assignments: part, summary: { demo: true, perUser: plan.perUser } });
  return r.user;
}
const ADMIN_LABEL = "Bob The Builder";
function LoginScreen({ onSignedIn }) {
  const [mode, setMode] = useState("name");
  const [email, setEmail] = useState(DEMO ? DEMO_SUPERVISOR.email : "");
  const [pw, setPw] = useState(DEMO ? DEMO_SUPERVISOR.password : "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(null);
  const [su, setSu] = useState({ first_name: "", last_name: "", email: "", designation: "", pw: "", pw2: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [status, setStatus] = useState(null);
  const [resetAsk, setResetAsk] = useState(false);
  const finish = (r) => { setToken(r.token); onSignedIn(r.user); };
  const guard = async (fn) => { setBusy(true); setErr(null); try { await fn(); } catch (e2) { setErr(e2.message); } setBusy(false); };
  const info = useRpc("meta.info", {}, []);
  /* Sign in by name: type the name, pick yourself (with your employee ID), then password — or create one the first time. */
  const [nameQ, setNameQ] = useState("");
  const [matches, setMatches] = useState(null);
  const [person, setPerson] = useState(null);
  const [setup, setSetup] = useState(null);
  const [npw, setNpw] = useState({ code: "", a: "", b: "" });
  useEffect(() => {
    if (mode !== "name" || person) return;
    const q = nameQ.trim();
    if (q.length < 2) { setMatches(null); return; }
    const t = setTimeout(() => { rpc("auth.lookup", { q }).then((r) => setMatches(r.matches)).catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [nameQ, mode, person]);
  const startAdmin = (m) => guard(async () => { const r = await rpc("auth.adminCode", { user_id: m ? m.id : undefined }); setPerson({ id: r.user_id, name: r.name, admin: true, designation: "Admin" }); setSetup({ ...r, via: "email", admin: true }); setNpw({ code: "", a: "", b: "" }); });
  const adminVerify = (e) => { if (e) e.preventDefault(); guard(async () => { const r = await rpc("auth.adminVerify", { user_id: person.id, code: npw.code.trim() }); finish(r); }); };
  const pickPerson = (m) => { if (m.admin) { startAdmin(m); return; } setPerson(m); setErr(null); setSetup(null); setNpw({ code: "", a: "", b: "" }); setPw(""); if (!m.has_password) setSetup({ via: "first" }); };
  const startSetup = (m) => guard(async () => { const r = await rpc("auth.setupCode", { user_id: m.id }); setSetup(r); setNpw({ code: "", a: "", b: "" }); });
  const loginByName = (e) => { if (e) e.preventDefault(); guard(async () => { const r = await rpc("auth.loginById", { user_id: person.id, passHash: await sha256Hex(pw) }); finish(r); }); };
  const completeSetup = (e) => {
    if (e) e.preventDefault();
    if (npw.a.length < 8) { setErr("Use a password of at least 8 characters."); return; }
    if (npw.a !== npw.b) { setErr("The two passwords don't match."); return; }
    guard(async () => {
      const passHash = await sha256Hex(npw.a);
      const r = setup && setup.via === "first" ? await rpc("auth.firstPassword", { user_id: person.id, passHash }) : await rpc("auth.completeSetup", { user_id: person.id, code: npw.code.trim(), passHash });
      finish(r);
    });
  };
  const loginPw = (e) => { if (e) e.preventDefault(); guard(async () => { const r = await rpc("auth.login", { email: email.trim(), passHash: await sha256Hex(pw) }); finish(r); }); };
  const sendCode = (e, addr) => { if (e) e.preventDefault(); const to = (addr || email).trim(); guard(async () => { const r = await rpc("auth.sendOtp", { email: to }); setSent({ ...r, email: to }); setCode(""); }); };
  const verify = (e) => { if (e) e.preventDefault(); guard(async () => { const r = await rpc("auth.verifyOtp", { email: sent.email, code: code.trim() }); finish(r); }); };
  const signup = (e) => {
    e.preventDefault();
    if (!mailOk(su.email)) { setErr("Enter a valid work email."); return; }
    if (!domainOk(su.email)) { setErr("Team lead accounts need a Purview email (" + domainHint() + ")."); return; }
    if (!su.designation) { setErr("Pick your designation."); return; }
    if (su.pw.length < 8) { setErr("Use a password of at least 8 characters."); return; }
    if (su.pw !== su.pw2) { setErr("The two passwords don't match."); return; }
    guard(async () => { const r = await rpc("auth.signup", { first_name: su.first_name, last_name: su.last_name, email: su.email.trim(), designation: su.designation, passHash: await sha256Hex(su.pw) }); setEmail(su.email.trim()); setSent({ ...r, email: su.email.trim(), signup: true }); setCode(""); setMode("code"); });
  };
  const seed = async () => {
    setBusy(true); setErr(null);
    try { const u = await seedDemo(setStatus); setStatus(null); toast("Sample data loaded. Sign in as a biller (same password, or a code) to see their day."); onSignedIn(u); }
    catch (e2) { setErr(e2.message); setStatus(null); }
    setBusy(false);
  };
  const resetDemo = async () => {
    setBusy(true); setErr(null);
    try { const b = await getLocalBackend(); await b.reset(); setToken(null); setResetAsk(false); toast("Demo data cleared."); }
    catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  const tab = (k, l) => <button key={k} type="button" className={"chip " + (mode === k ? "on" : "")} onClick={() => { setMode(k); setErr(null); }}>{l}</button>;
  return (
    <div className="login">
      <div className="box stack">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}><Wordmark size={30} /></div>
        <div className="card stack">
          {mode !== "signup" && <div className="row" style={{ gap: 4 }}>{tab("name", "Sign in")}{tab("code", "Email code")}{tab("password", "Email & password")}</div>}
          {mode === "name" && !person && (
            <div className="stack">
              <h2>Sign in</h2>
              <div className="small muted">Type your name and pick yourself from the list. Everyone is already here from the roster.</div>
              <Field label="Your name"><input className="input" value={nameQ} onChange={(e) => setNameQ(e.target.value)} placeholder="e.g. Pawan" autoFocus autoComplete="off" /></Field>
              {matches && matches.length > 0 && <div className="stack" style={{ gap: 6 }}>
                {matches.map((m) => <button key={m.id} type="button" className="btn" style={{ justifyContent: "space-between", display: "flex", width: "100%", textAlign: "left" }} onClick={() => pickPerson(m)}>
                  <span><b>{m.name}</b><span className="muted"> · {m.emp_id || "no ID"}</span><div className="tiny muted">{[m.designation, m.department].filter(Boolean).join(" · ")}</div></span>
                  {m.admin ? <span className="badge purple" style={{ alignSelf: "center" }}>admin · code</span> : !m.has_password && <span className="badge amber" style={{ alignSelf: "center" }}>first time</span>}
                </button>)}
              </div>}
              {matches && !matches.length && <div className="small muted">{info.data && !info.data.roster ? "Nobody by that name yet: the Shastra roster has not been loaded into Brahmastra. Your admin loads it from the Roster screen; until then, sign in with your email (Email code)." : "Nobody by that name. Check the spelling, or ask your team lead to add you in Purview Shastra."}</div>}
              <ErrorBox error={err} />
            </div>
          )}
          {mode === "name" && person && (
            <div className="stack">
              <div className="row between"><div><h2>{person.name}</h2><div className="sub">{[person.emp_id, person.designation, person.department].filter(Boolean).join(" · ")}</div></div>
                <button type="button" className="btn sm link" onClick={() => { setPerson(null); setSetup(null); setErr(null); }}>Not you?</button></div>
              {person.has_password && !setup && (
                <form className="stack" onSubmit={loginByName}>
                  <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
                  <ErrorBox error={err} />
                  <button className="btn primary" type="submit" disabled={busy}>{busy ? "Please wait…" : "Sign in"}</button>
                  <div className="small muted">Forgot it? <button type="button" className="btn link sm" disabled={busy} onClick={() => startSetup(person)}>Reset with a one-time code</button></div>
                </form>
              )}
              {setup && setup.admin && (
                <form className="stack" onSubmit={adminVerify}>
                  <div className="small muted">A 6-digit code was sent to the admin mailbox <b>{setup.email_hint}</b>. It works for 10 minutes. <button type="button" className="btn link sm" disabled={busy} onClick={() => startAdmin(person)}>Send a new code</button></div>
                  {setup.demo_code && <div className="alert info">Demo mode, no email is sent: your code is <b className="mono" style={{ fontSize: 18 }}>{setup.demo_code}</b></div>}
                  <Field label="One-time code"><input className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={npw.code} onChange={(e) => setNpw({ ...npw, code: e.target.value.replace(/\D/g, "") })} required autoFocus style={{ fontSize: 22, letterSpacing: 6 }} /></Field>
                  <ErrorBox error={err} />
                  <button className="btn primary" type="submit" disabled={busy || npw.code.length < 6}>{busy ? "Checking…" : "Sign in as admin"}</button>
                </form>
              )}
              {setup && !setup.admin && (
                <form className="stack" onSubmit={completeSetup}>
                  {setup.via === "first" && <div className="alert info">First time here: choose your password. From now on you sign in with your name and this password.</div>}
                  {setup.via === "email" && <div className="small muted">We sent a 6-digit code to <b>{setup.email_hint}</b>. It works for 10 minutes. <button type="button" className="btn link sm" disabled={busy} onClick={() => startSetup(person)}>Send a new code</button></div>}
                  {setup.via === "lead" && <div className="alert warn">There is no usable email on file for you, so ask your team lead for a sign-in code (they get it from the Team screen in a few seconds) and enter it below.</div>}
                  {setup.demo_code && <div className="alert info">Demo mode, no email is sent: your code is <b className="mono" style={{ fontSize: 18 }}>{setup.demo_code}</b></div>}
                  {setup.via !== "first" && <Field label="One-time code"><input className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={npw.code} onChange={(e) => setNpw({ ...npw, code: e.target.value.replace(/\D/g, "") })} required autoFocus style={{ fontSize: 22, letterSpacing: 6 }} /></Field>}
                  <div className="grid g2">
                    <Field label={person.has_password ? "New password" : "Choose a password"} hint="At least 8 characters"><input className="input" type="password" autoComplete="new-password" value={npw.a} onChange={(e) => setNpw({ ...npw, a: e.target.value })} required autoFocus={setup.via === "first"} /></Field>
                    <Field label="Password again"><input className="input" type="password" autoComplete="new-password" value={npw.b} onChange={(e) => setNpw({ ...npw, b: e.target.value })} required /></Field>
                  </div>
                  <ErrorBox error={err} />
                  <button className="btn primary" type="submit" disabled={busy || (setup.via !== "first" && npw.code.length < 6)}>{busy ? "Please wait…" : person.has_password ? "Reset password & sign in" : "Create password & sign in"}</button>
                </form>
              )}
            </div>
          )}
          {mode === "code" && !sent && (
            <form className="stack" onSubmit={sendCode}>
              <h2>Sign in</h2>
              <div className="small muted">A one-time code is emailed to you each time you sign in.</div>
              <Field label="Work email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
              <ErrorBox error={err} />
              <button className="btn primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send me a code"}</button>
            </form>
          )}
          {mode === "code" && sent && (
            <form className="stack" onSubmit={verify}>
              <h2>{sent.signup ? "Confirm your email" : "Enter your code"}</h2>
              <div className="small muted">{sent.sent ? <>We sent a 6-digit code to <b>{sent.email}</b>. It works for 10 minutes.</> : <>Code issued for <b>{sent.email}</b>.</>}</div>
              {sent.demo_code && <div className="alert info">Demo mode, no email is sent: your code is <b className="mono" style={{ fontSize: 18 }}>{sent.demo_code}</b></div>}
              <Field label="Code"><input className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required autoFocus style={{ fontSize: 22, letterSpacing: 6 }} /></Field>
              <ErrorBox error={err} />
              <button className="btn primary" type="submit" disabled={busy || code.length < 6}>{busy ? "Checking…" : sent.signup ? "Create my account" : "Sign in"}</button>
              <div className="row small"><button type="button" className="btn link sm" disabled={busy} onClick={() => sendCode(null, sent.email)}>Send a new code</button><button type="button" className="btn link sm" disabled={busy} onClick={() => { setSent(null); setErr(null); }}>Use another email</button></div>
            </form>
          )}
          {mode === "password" && (
            <form className="stack" onSubmit={loginPw}>
              <h2>Sign in</h2>
              <Field label="Work email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
              <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
              <ErrorBox error={err} />
              <button className="btn primary" type="submit" disabled={busy}>{busy ? "Please wait…" : "Sign in"}</button>
              <div className="small muted">Forgot it? <button type="button" className="btn link sm" onClick={() => { setMode("code"); setSent(null); setErr(null); }}>Sign in with a code</button> and set a new password from the menu.</div>
            </form>
          )}
          {mode === "signup" && (
            <form className="stack" onSubmit={signup}>
              <h2>Create a team lead account</h2>
              <div className="small muted">For team leads and managers. Billers' accounts are created by their team lead on the Team screen.</div>
              <div className="grid g2">
                <Field label="First name"><input className="input" value={su.first_name} onChange={(e) => setSu({ ...su, first_name: e.target.value })} required autoFocus /></Field>
                <Field label="Last name"><input className="input" value={su.last_name} onChange={(e) => setSu({ ...su, last_name: e.target.value })} required /></Field>
              </div>
              <Field label="Work email" hint={"Allowed: " + domainHint()}><input className="input" type="email" autoComplete="username" value={su.email} onChange={(e) => setSu({ ...su, email: e.target.value })} required /></Field>
              <Field label="Designation"><Combo value={su.designation} onChange={(v) => setSu({ ...su, designation: v })} placeholder="Pick…" options={DESIGNATIONS.map((d) => ({ id: d, label: d }))} /></Field>
              <div className="grid g2">
                <Field label="Password" hint="At least 8 characters"><input className="input" type="password" autoComplete="new-password" value={su.pw} onChange={(e) => setSu({ ...su, pw: e.target.value })} required /></Field>
                <Field label="Password again"><input className="input" type="password" autoComplete="new-password" value={su.pw2} onChange={(e) => setSu({ ...su, pw2: e.target.value })} required /></Field>
              </div>
              <ErrorBox error={err} />
              <button className="btn primary" type="submit" disabled={busy}>{busy ? "Sending…" : "Send me a code to confirm"}</button>
              <div className="small muted">Already have an account? <button type="button" className="btn link sm" onClick={() => { setMode("code"); setErr(null); }}>Sign in</button></div>
            </form>
          )}
          {status && <div className="alert info"><span className="spin" /> {status}</div>}
          {mode === "name" && !person && <div className="small muted" style={{ textAlign: "center" }}><button type="button" className="btn link sm" disabled={busy} onClick={() => startAdmin(null)}>🔐 Access Admin – {ADMIN_LABEL}</button></div>}
        </div>
        {DEMO && (
          <div className="card tight stack" style={{ gap: 8 }}>
            <div className="b">Demo mode</div>
            <div className="small muted">This copy runs its server inside your browser and sends no email: codes are shown on screen. Team lead: <span className="mono">{DEMO_SUPERVISOR.email}</span> / <span className="mono">{DEMO_SUPERVISOR.password}</span>. Load sample data to add three billers ({DEMO_USERS.map((u) => u[1].split(" ")[0]).join(", ")}, same password), two clients and inventory.</div>
            <div className="row">
              <button className="btn sm" onClick={seed} disabled={busy}>Load sample data</button>
              <button className="btn sm link" onClick={() => setResetAsk(true)} disabled={busy}>Reset demo data</button>
            </div>
          </div>
        )}
        <div className="tiny muted" style={{ textAlign: "center" }}>Purview Brahmastra {APP_VERSION} · {DEMO ? "demo mode" : "connected to " + API_BASE.replace(/^https?:\/\//, "")}</div>
      </div>
      {resetAsk && <Confirm title="Reset demo data?" text="Every client, claim, note and account created in this browser's demo will be deleted. The default team lead account comes back automatically." confirmLabel="Reset" danger onYes={resetDemo} onNo={() => setResetAsk(false)} busy={busy} />}
    </div>
  );
}
function ChangePasswordForm({ forced, onDone, onCancel, me }) {
  const [f, setF] = useState({ old: "", a: "", b: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const needOld = !!(me && me.has_password) && !(me && me.via === "otp");
  const submit = async (e) => {
    e.preventDefault();
    if (f.a.length < 8) { setErr("Use at least 8 characters."); return; }
    if (f.a !== f.b) { setErr("The two new passwords don't match."); return; }
    setBusy(true); setErr(null);
    try { await rpc("auth.changePassword", { oldHash: needOld ? await sha256Hex(f.old) : undefined, newHash: await sha256Hex(f.a) }); toast("Password saved."); onDone(); }
    catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  return (
    <form className="stack" onSubmit={submit}>
      {forced && <div className="alert info">Welcome. Set a password of your own before you start.</div>}
      {!needOld && !forced && <div className="small muted">{me && me.has_password ? "You signed in with a code, so no current password is needed." : "You have no password yet. With one, you can also sign in without waiting for a code."}</div>}
      {needOld && <Field label={forced ? "Temporary password" : "Current password"}><input className="input" type="password" autoComplete="current-password" value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} required /></Field>}
      <Field label="New password" hint="At least 8 characters"><input className="input" type="password" autoComplete="new-password" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} required /></Field>
      <Field label="New password again"><input className="input" type="password" autoComplete="new-password" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} required /></Field>
      <ErrorBox error={err} />
      <div className="row" style={{ justifyContent: "flex-end" }}>{onCancel && <button className="btn" type="button" onClick={onCancel}>Cancel</button>}<button className="btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button></div>
    </form>
  );
}

/* ---------- settings: theme, text size, password, profile ---------- */
const PREFS_KEY = "brahmastra:prefs";
const THEMES = [
  ["light", "Light", "Cool off-white, as on the Purview site", ["#EEF1F4", "#FFFFFF", "#0F1B24", "#17B39A"]],
  ["navy", "Navy", "Purview navy, easy on the eyes", ["#071E33", "#0B2740", "#FFFFFF", "#2FD9B3"]],
  ["gold", "Gold", "Black and gold", ["#0A0A0B", "#141416", "#F5F0E4", "#D4AF37"]],
  ["auto", "Match my computer", "Light by day, Navy when the computer is dark", null],
];
function readPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {}; } catch (e) { return {}; } }
function applyPrefs(p) {
  const el = document.documentElement;
  let t = p.theme || "light";
  if (t === "auto") t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "navy" : "light";
  if (t === "light") el.removeAttribute("data-theme"); else el.setAttribute("data-theme", t);
  if (p.text === "large") el.setAttribute("data-text", "large"); else el.removeAttribute("data-text");
}
function storePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {} applyPrefs(p); }
// "Match my computer" follows the computer when it switches between light and dark
if (window.matchMedia) { try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (readPrefs().theme === "auto") applyPrefs(readPrefs()); }); } catch (e) {} }
function ThemePreview({ c }) {
  if (!c) return <div className="pv" style={{ gridTemplateColumns: "1fr 1fr" }}><ThemePreviewHalf c={THEMES[0][3]} /><ThemePreviewHalf c={THEMES[1][3]} /></div>;
  return <div className="pv" style={{ background: c[0] }}><i style={{ background: c[1], borderRight: "1px solid rgba(127,127,127,.15)" }} /><div className="pc"><b style={{ background: c[2], width: "70%" }} /><b className="s" style={{ background: c[2] }} /><b style={{ background: c[3], width: "40%", marginTop: "auto" }} /></div></div>;
}
function ThemePreviewHalf({ c }) { return <div style={{ background: c[0], padding: 9, display: "flex", flexDirection: "column", gap: 6 }}><b style={{ display: "block", height: 7, borderRadius: 4, background: c[2], width: "80%" }} /><b style={{ display: "block", height: 7, borderRadius: 4, background: c[3], width: "45%", marginTop: "auto" }} /></div>; }
function SettingsView({ me, setMe, ctx }) {
  const [prefs, setPrefs] = useState(() => ({ theme: "light", text: "normal", ...readPrefs(), ...(me.prefs || {}) }));
  const [others, setOthers] = useState(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState(null);
  useEffect(() => { rpc("auth.sessions").then((r) => setOthers(r.others)).catch(() => {}); rpc("meta.info").then(setInfo).catch(() => {}); }, []);
  const save = async (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next); storePrefs(next);
    try { const r = await rpc("auth.savePrefs", patch); setMe((m) => ({ ...m, prefs: r.prefs })); } catch (e) { toast("Saved on this computer only: " + e.message, "err"); }
  };
  const endOthers = async () => {
    setBusy(true);
    try { const r = await rpc("auth.signOutOthers"); setOthers(0); toast(r.ended ? `Signed out on ${r.ended} other ${r.ended === 1 ? "device" : "devices"}.` : "No other devices were signed in."); } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const lead = me.role === "supervisor";
  const projects = (me.projects || []).map((p) => p.name || p).filter(Boolean);
  const myClients = lead ? (me.access_all ? ["Every project"] : (me.scope_projects || [])) : projects;
  const dash = <span className="muted" style={{ fontWeight: 400 }}>not on the roster</span>;
  const secs = [["appearance", "Appearance"], ...(lead ? [["email", "Email"]] : []), ["access", "What you can see"], ["password", "Password & sign-in"], ["profile", "My profile"], ...(lead ? [["apps", "Connected apps"]] : []), ["about", "About"]];
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div><h1>Settings</h1><div className="sub">How Brahmastra looks for you, your password, and what Brahmastra knows about you.</div></div>
      <div className="set-wrap">
        <nav className="set-nav">{secs.map(([k, l]) => <a key={k} href={"#/settings"} onClick={(e) => { e.preventDefault(); const el = document.getElementById("set-" + k); if (el) el.scrollIntoView({ behavior: "smooth" }); }}>{l}</a>)}</nav>
        <div className="stack" style={{ gap: 16 }}>
          <div className="card set-sec" id="set-appearance">
            <h2>Appearance</h2><div className="sub">The same themes as Purview Shastra. Your choice is saved to your account, so it follows you to any computer.</div>
            <div className="theme-grid">{THEMES.map(([k, l, d, c]) => (
              <button key={k} type="button" className={"theme-opt" + (prefs.theme === k ? " on" : "")} onClick={() => save({ theme: k })}>
                <ThemePreview c={c} /><div className="nm">{l}{prefs.theme === k && <span className="badge teal">In use</span>}</div><div className="ds">{d}</div></button>))}</div>
            <div className="row between mt16" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <div><div className="b">Text size</div><div className="small muted">Larger makes every screen about 10% bigger.</div></div>
              <div className="seg2">{[["normal", "Normal"], ["large", "Larger"]].map(([k, l]) => <button key={k} className={prefs.text === k ? "on" : ""} onClick={() => save({ text: k })}>{l}</button>)}</div>
            </div>
          </div>
          {lead && <div className="card set-sec" id="set-email">
            <h2>Email</h2><div className="sub">What Brahmastra emails you, besides sign-in codes.</div>
            <div className="row between mt8">
              <div><div className="b">Monday digest</div><div className="small muted">Every Monday about 8:30 AM IST, one email for each manager's span you are a supervisor in (their clients): last week's health, AR, over 90, collected, entries, what needs attention, client by client, and the team. No patient details. Preview it from Client 360 or Portfolio.</div></div>
              <div className="seg2">{[["on", "On"], ["off", "Off"]].map(([k, l]) => <button key={k} className={(prefs.digest || "on") === k ? "on" : ""} onClick={() => save({ digest: k })}>{l}</button>)}</div>
            </div>
          </div>}
          <div className="card set-sec" id="set-access">
            <h2>What you can see</h2><div className="sub">Client access follows the Purview Shastra hierarchy; this is how it lands for you.</div>
            {me.is_admin ? <div className="small mt8">You are an <b>admin</b>, so you see every client and every screen. Everyone from the roster sees only their own span.</div>
              : me.access_all ? <div className="small mt8"><b>Vice President:</b> you see every client.</div>
              : (me.source !== "roster" && !(me.projects || []).length) ? <div className="small mt8">This account was <b>added by hand with no projects</b>, so it sees every client. Give it projects in Team to narrow it, or sign in with your roster account.</div>
              : <>
                <div className="small mt8"><b>Your projects{(me.scope_projects || []).length > (me.projects || []).length ? " and your span's" : ""}:</b> {((me.scope_projects || []).length ? me.scope_projects : (me.projects || []).map((p) => p.name || p)).filter(Boolean).join("; ") || "none yet"}</div>
                <div className="small mt8"><b>Clients that open for you ({(ctx.clients || []).length}):</b> {(ctx.clients || []).map((c) => c.name).join(", ") || "none matched yet (ask your team lead to map your project to a client)"}</div>
              </>}
            <div className="tiny muted mt8">Billers and team leads see their own projects' clients, managers everything under them in the hierarchy, the VP and admins everything. A client outside your span can be shared with you from its client card (view only or can edit).</div>
          </div>
          <div className="card set-sec" id="set-password">
            <h2>Password &amp; sign-in</h2><div className="sub">You signed in {me.via === "otp" ? "with a code" : "with your password"}{me.last_login ? <> · last sign-in {fmtWhen(me.last_login)}</> : null}. Saving a new password signs you out everywhere else.</div>
            <div style={{ maxWidth: 440 }}><ChangePasswordForm me={me} onDone={() => { setMe((m) => ({ ...m, has_password: true })); setOthers(0); }} /></div>
            <div className="row between mt16" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <div><div className="b">Other devices</div><div className="small muted">{others === null ? "Checking…" : others ? `You are also signed in on ${others} other ${others === 1 ? "device or browser" : "devices or browsers"}.` : "You are signed in only here."} Use this if you signed in on a shared computer.</div></div>
              <button className="btn" disabled={busy || !others} onClick={endOthers}>Sign out everywhere else</button>
            </div>
          </div>
          <div className="card set-sec" id="set-profile">
            <h2>My profile</h2><div className="sub">From the Purview Shastra roster. If something is wrong, ask your team lead or the admin to correct it on the roster.</div>
            <dl className="cv-kv">
              <dt>Name</dt><dd>{me.name}</dd><dt>Email</dt><dd>{me.email}</dd>
              <dt>Emp ID</dt><dd>{me.emp_id || dash}</dd><dt>Designation</dt><dd>{me.designation || me.position || dash}</dd>
              <dt>Department</dt><dd>{me.department || dash}{me.departments_also ? <span className="muted" style={{ fontWeight: 400 }}> · also {me.departments_also}</span> : null}</dd><dt>Brahmastra role</dt><dd>{roleLabel(me)}</dd>
              <dt>Reports to</dt><dd>{me.reports_to_name || dash}</dd><dt>Shift</dt><dd>{me.shift || dash}</dd>
              <dt>{lead ? "Projects I lead" : "My projects"}</dt><dd>{myClients.length ? myClients.join(", ") : dash}</dd><dt>Status</dt><dd>{me.roster_status || "Production"}</dd>
              {!lead && <><dt>Daily target</dt><dd>{me.capacity ? me.capacity + " claims a day" : dash}</dd></>}
              <dt>Date of joining</dt><dd>{me.doj ? fmtDate(me.doj) : dash}</dd>
              <dt>Member since</dt><dd>{me.created_at ? new Date(me.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : dash}</dd>
            </dl>
          </div>
          {lead && <div className="card set-sec" id="set-apps">
            <h2>Connected apps</h2><div className="sub">Each has its own tab: SLA, and Sasha's Third Eye. You never sign in to them separately.</div>
            <dl className="cv-kv" style={{ gridTemplateColumns: "150px minmax(0,1fr)" }}>
              <dt>Drishti</dt><dd>Opens signed in as you, from your Brahmastra sign-in</dd>
              <dt>Sasha's Third Eye</dt><dd>No sign-in needed</dd>
              <dt>OneDrive</dt><dd>Every upload and saved report uses <span className="mono">Purviewautomate@purview-healthcare.com</span> only</dd>
              <dt>Report files</dt><dd>OneDrive › Brahmastra Reports › team lead › client</dd>
            </dl>
          </div>}
          <div className="card set-sec" id="set-about">
            <h2>About</h2>
            <dl className="cv-kv" style={{ gridTemplateColumns: "150px minmax(0,1fr)" }}>
              <dt>Brahmastra</dt><dd>App {APP_VERSION}{info ? " · server " + info.version : ""}{DEMO ? " · demo" : ""}</dd>
              <dt>Need help?</dt><dd>Ask your team lead, or the admin for sign-in and roster questions.</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- shell ---------- */
// Older screen names still open, inside the merged tabs.
const NAV_ALIAS = { allocate: "inventory", locations: "clients", queue: "mydesk", teamtoday: "live", portfolio: "dashboard", reports: "claims" };
const USER_NAV = [["queue", "My day"], ["history", "My work"]];
/* A person deletes their own sign-in. Typing the email is the confirmation. */
function DeleteMyAccount({ me, onClose, onDeleted }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = typed.trim().toLowerCase() === String(me.email || "").toLowerCase();
  const go = async () => {
    setBusy(true);
    try { await rpc("auth.deleteMyAccount", { confirm: typed.trim() }); toast("Your account has been deleted."); onDeleted(); }
    catch (e) { toast(e.message, "err"); setBusy(false); }
  };
  return (
    <Modal title="Delete my account" sub="Your sign-in is removed and you are signed out. Claims you were working go back to the pool. Your notes stay in the claim history under your name." onClose={onClose} narrow footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn danger" onClick={go} disabled={!ready || busy}>{busy ? "Deleting…" : "Delete my account"}</button></>}>
      <Field label={"Type " + me.email + " to confirm"}><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}
/* Payment posting & submission: every team lead sees the tab; anyone else once they lead, back up or work hand-offs, or sits in those departments. */
const HANDOFF_DEPTS = /^(posting|submission)$/i;
const handoffTab = (me, ho) => me.role === "supervisor" || HANDOFF_DEPTS.test(String(me.department || "").trim()) || !!(ho && ho.involved);
/* Someone whose work is only posting, or only submission (set on clients, or their department), and who is not an AR
   biller, gets a desk for that work alone: its own tab, landing page and wording. Returns "posting", "submission" or null. */
const DESK = { posting: { tab: "Payment posting", role: "payment posting" }, submission: { tab: "Submission", role: "submission" }, both: { tab: "Posting & submission", role: "posting & submission" } };
/* The Shastra department and the "also in" departments. Anyone on AR keeps the AR view. */
function deptDesk(me) {
  const d = new Set([me.department, ...String(me.departments_also || "").split(/[;,]/)].map((x) => String(x || "").trim().toLowerCase()).filter(Boolean));
  if (d.has("ar")) return { ar: true, desk: null };
  const p = d.has("posting"), s = d.has("submission");
  return { ar: false, desk: p && s ? "both" : p ? "posting" : s ? "submission" : null };
}
function deskOf(me, ho) {
  if (!me || me.is_admin) return null;
  const dd = deptDesk(me);
  if (dd.ar) return null;
  if (me.role === "supervisor" || dd.desk) return dd.desk;   // a Payment posting / Submission person or team lead
  if (!ho || !ho.depts || !ho.depts.length) return null;
  const d = new Set(ho.depts);
  if (d.has("posting") && !d.has("submission") && !d.has("subcheck")) return "posting";
  if (!d.has("posting")) return "submission";
  return "both";
}
/* The tabs, with the less-used screens grouped under Work and Manage so the bar stays one row. */
const navFor = (me, ho, fb, at) => {
  const inbox = fb && fb.reader ? [["feedback", "Feedback inbox"]] : [];
  const desk = deskOf(me, ho);
  // Posting and Submission work only on what is handed to them: no AR screens (SAAG, inventory, allocation, attention, TFL)
  if (desk && me.role === "supervisor") return [["sla", "SLA"], ["thirdeye", "Sasha's Third Eye"], ["dashboard", "Dashboard"], ["handoffs", DESK[desk].tab], ["claims", "Claims"], ["escalations", "Escalation tracker"],
    { g: "Manage", items: [["client", "Client 360"], ["team", "Team"], ["clients", "Clients & locations"], ["raci", "RACI tracker"], ...inbox] }];
  const respNav = (me.resp_clients || []).length ? [["claims", "Claims"]] : [];
  if (desk) return [["handoffs", DESK[desk].tab], ["history", "My work"], ...respNav, ["clients", "My clients"], ...inbox];
  if (me.role !== "supervisor") {
    const base = [...USER_NAV, ...respNav, ["clients", "My clients"]];
    return [...(handoffTab(me, ho) ? [...base, ["handoffs", "Posting & submission"]] : base), ...inbox];
  }
  // Team today is part of the Dashboard now; Claims (the inventory list) has its own tab; Needs attention sits under Work
  // and its count also shows on the Dashboard tab.
  const work = [["attention", "Needs attention"], ...(handoffTab(me, ho) ? [["handoffs", "Posting & submission"]] : []), ["inventory", "Inventory & allocation"], ["saag", "SAAG reference"], ["escalations", "Escalation tracker"], ...(at && at.my_desk > 0 ? [["mydesk", "My desk"]] : [])];
  const manage = [["client", "Client 360"], ["team", "Team"], ["templates", "Note templates"], ["clients", "Clients & locations"], ["raci", "RACI tracker"], ["limits", "TFL / AFL"], ...(me.is_admin ? [["roster", "Roster"]] : []), ...(me.is_admin || me.access_all ? [["audit", "Audit trail"]] : []), ...inbox];
  return [["sla", "SLA"], ["thirdeye", "Sasha's Third Eye"], ["live", "Live status"], ["dashboard", "Dashboard"], ["claims", "Claims"], { g: "Work", items: work }, { g: "Manage", items: manage }];
};
/* Every page in the bar, the ones inside the Work and Manage menus included. */
const navItems = (nav) => nav.flatMap((x) => (Array.isArray(x) ? [x] : x.items));
const roleLabel = (me) => (me.is_admin ? "Admin" : me.access_all ? "Vice President" : me.roster_kind === "manager" ? (me.designation || "Manager") : me.role === "supervisor" ? (/^(sme|subject matter)/i.test(me.designation || "") ? "SME" : "Team lead") : "Biller");
/* ---------- Ctrl+K: jump to a page, a client, a person or a claim from anywhere ---------- */
const CMDK_ORDER = ["Page", "Client", "Person", "Claim"];
function CommandPalette({ ctx, me, pages, onClose, go, openClaim, openCoach }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [found, setFound] = useState({ rows: [], loading: false });
  const inp = useRef(null);
  const list = useRef(null);
  useEffect(() => { if (inp.current) inp.current.focus(); }, []);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setFound({ rows: [], loading: false }); return undefined; }
    let alive = true;
    setFound((f) => ({ ...f, loading: true }));
    const h = setTimeout(() => rpc("search.global", { q: t }).then((r) => alive && setFound({ rows: r.claims || [], loading: false })).catch(() => alive && setFound({ rows: [], loading: false })), 200);
    return () => { alive = false; clearTimeout(h); };
  }, [q]);
  useEffect(() => { setSel(0); }, [q, found.rows.length]);
  const needle = q.trim().toLowerCase();
  const has = (s) => String(s || "").toLowerCase().includes(needle);
  const can = (k) => pages.some(([p]) => p === k);
  const results = [];
  pages.filter(([, l]) => !needle || has(l)).slice(0, needle ? 6 : 14).forEach(([k, l]) => results.push({ kind: "Page", key: "p" + k, label: l, run: () => go(k) }));
  if (needle && can("client")) ctx.clients.filter((c) => c.active && (has(c.name) || has(c.code))).slice(0, 5).forEach((c) => results.push({ kind: "Client", key: "c" + c.id, label: c.name, sub: "open Client 360", run: () => go("client", { client_id: c.id }) }));
  if (needle && me.role === "supervisor" && can("live")) (ctx.users || []).filter((u) => u.active && u.role === "user" && (has(u.name) || has(u.email))).slice(0, 5).forEach((u) => results.push({ kind: "Person", key: "u" + u.id, label: u.name, sub: "coaching card", run: () => openCoach(u.id) }));
  found.rows.forEach((c) => results.push({ kind: "Claim", key: "k" + c.id, label: c.claim_no, phi: c.patient, sub: [c.client_name, c.payer, fmtMoney(c.balance), c.assigned_name ? "with " + c.assigned_name : c.state].filter(Boolean).join(" · "), run: () => openClaim(c.id) }));
  results.sort((a, b) => CMDK_ORDER.indexOf(a.kind) - CMDK_ORDER.indexOf(b.kind));
  const pick = (r) => { if (!r) return; onClose(); r.run(); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(results[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };
  useEffect(() => { const el = list.current && list.current.querySelector(".on"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); }, [sel]);
  return (
    <div className="overlay cmdk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmdk" role="dialog" aria-label="Search">
        <div className="cmdk-in"><SearchIcon /><input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder={me.role === "supervisor" ? "Go to a page, client, biller, or a claim # / account / patient…" : "Go to a page, or find a claim # / account / patient…"} />
          {found.loading ? <span className="spin" /> : <kbd>Esc</kbd>}</div>
        <div className="cmdk-list" ref={list}>
          {results.map((r, i) => <React.Fragment key={r.key}>
            {(i === 0 || results[i - 1].kind !== r.kind) && <div className="cmdk-h">{r.kind === "Person" ? "People" : r.kind + "s"}</div>}
            <button type="button" className={"cmdk-item" + (i === sel ? " on" : "")} onMouseEnter={() => setSel(i)} onClick={() => pick(r)}>
              <span className="b">{r.label}</span>{r.phi && <span className="phi"> · {r.phi}</span>}{r.sub && <span className="tiny muted"> · {r.sub}</span>}
            </button></React.Fragment>)}
          {!results.length && <div className="small muted" style={{ padding: "14px 16px" }}>{found.loading ? "Searching…" : needle.length < 2 ? "Type to search." : "Nothing matches " + JSON.stringify(q.trim()) + (me.role === "supervisor" ? " in your clients." : " among the claims you have worked.")}</div>}
        </div>
        <div className="cmdk-foot tiny muted"><span><kbd>↑</kbd> <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open</span><span>Claims search the claim #, account and patient name</span></div>
      </div>
    </div>
  );
}
const SearchIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;
const BellIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>;
/* The bell: what needs this person now. A count shows for what changed since they last opened it. */
const BELL_KEY = "brahmastra2:bell";
function Bell({ notify, allowed, onGo }) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => { try { return JSON.parse(localStorage.getItem(BELL_KEY) || "{}") || {}; } catch (e) { return {}; } });
  const [was, setWas] = useState({});
  const items = ((notify && notify.items) || []).filter((x) => allowed.includes(x.view));
  const fresh = (x, s) => !(s[x.key] >= x.n);
  const unseen = items.filter((x) => fresh(x, seen));
  useEffect(() => { if (!open) return undefined; const h = () => setOpen(false); window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, [open]);
  const toggle = () => {
    if (!open) { const s = {}; items.forEach((x) => { s[x.key] = x.n; }); setWas(seen); setSeen(s); try { localStorage.setItem(BELL_KEY, JSON.stringify(s)); } catch (e) {} }
    setOpen(!open);
  };
  const dot = { red: "#C94F4F", amber: "#E8A13C", info: "var(--teal)" };
  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={"btn sm icon-btn" + (open ? " on" : "")} aria-label={"Notifications" + (unseen.length ? ", " + unseen.length + " new" : "")} title="What needs you" onClick={toggle}>
        <BellIcon />{unseen.length > 0 && <span className={"bell-n" + (unseen.some((x) => x.tone === "red") ? " red" : "")}>{unseen.length}</span>}</button>
      {open && <div className="menu bell-menu">
        <div className="row between" style={{ padding: "6px 10px 8px" }}><b className="small">What needs you</b><span className="tiny muted">{notify && notify.at ? "as of " + new Date(notify.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span></div>
        {items.map((x) => <button key={x.key} type="button" className="bell-item" onClick={() => { setOpen(false); onGo(x.view, x.params); }}>
          <i style={{ background: dot[x.tone] || dot.info }} /><span>{x.text}</span>{fresh(x, was) && <span className="badge teal" style={{ marginLeft: "auto" }}>new</span>}</button>)}
        {!items.length && <div className="small muted" style={{ padding: "4px 10px 10px" }}>Nothing needs you right now.</div>}
      </div>}
    </div>
  );
}
/* Signed out after 5 minutes without a key, click, scroll or touch in any Brahmastra tab; a warning shows for the last minute. */
const IDLE_MIN = Number(window.BRAHMASTRA_IDLE_MIN) || 24 * 60, IDLE_WARN_SEC = Math.min(60, IDLE_MIN * 30), ACTIVE_KEY = "brahmastra2:active";
function useIdleSignOut(on, signOut) {
  const [left, setLeft] = useState(null);
  const out = useRef(signOut);
  out.current = signOut;
  useEffect(() => {
    if (!on) return undefined;
    let last = Date.now(), wrote = 0;
    const mark = () => { last = Date.now(); setLeft(null); if (last - wrote > 15000) { wrote = last; try { localStorage.setItem(ACTIVE_KEY, String(last)); } catch (e) {} } };
    const evs = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    mark();
    const t = setInterval(() => {
      // working inside the embedded Sasha's Third Eye or SLA page counts as activity too
      if (document.hasFocus() && document.activeElement && document.activeElement.tagName === "IFRAME") mark();
      let shared = 0; try { shared = Number(localStorage.getItem(ACTIVE_KEY)) || 0; } catch (e) {}
      const ms = IDLE_MIN * 60000 - (Date.now() - Math.max(last, shared));
      if (ms <= 0) { clearInterval(t); setLeft(null); Promise.resolve(out.current()).then(() => setTimeout(() => toast(`Signed out after ${IDLE_MIN < 1 ? "a while" : IDLE_MIN >= 60 ? Math.round(IDLE_MIN / 60) + " hours" : IDLE_MIN + " minutes"} without activity, to keep patient data safe.`), 100)); }
      else setLeft(ms <= IDLE_WARN_SEC * 1000 ? Math.ceil(ms / 1000) : null);
    }, 1000);
    return () => { evs.forEach((e) => window.removeEventListener(e, mark)); clearInterval(t); };
  }, [on]);
  return left;
}
/* ---------- Not logged in to Shastra (the team lead's pop-up, on any page) and new claims (the biller's banner),
   both also as the computer's own notification once the person allows it ---------- */
const canTellComputer = () => typeof window !== "undefined" && "Notification" in window;
function tellComputer(key, title, body) {
  try {
    if (!canTellComputer() || Notification.permission !== "granted") return;
    const day = todayISO(), told = JSON.parse(localStorage.getItem("brahmastra:told") || "{}");
    for (const k of Object.keys(told)) if (told[k] !== day) delete told[k];
    if (told[key]) return;
    told[key] = day; localStorage.setItem("brahmastra:told", JSON.stringify(told));
    const n = new Notification(title, { body, tag: key }); n.onclick = () => { try { window.focus(); } catch (e) {} n.close(); };
  } catch (e) {}
}
function AskComputer() {
  const [perm, setPerm] = useState(() => (canTellComputer() ? Notification.permission : "unsupported"));
  if (perm !== "default") return null;
  return <button type="button" className="btn sm link" title="Your browser asks once" onClick={async () => { try { setPerm(await Notification.requestPermission()); } catch (e) {} }}>Also show these on this computer</button>;
}
const clockNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
function MissingAlertPopup({ alerts, onChanged }) {
  const [hidden, setHidden] = useState({});
  const [busy, setBusy] = useState(false);
  const [idx, setIdx] = useState(0);
  const list = (alerts || []).filter((a) => a.popup && !hidden[a.user_id]);
  if (!list.length) return null;
  const a = list[Math.min(idx, list.length - 1)], first = a.name.split(" ")[0], share = a.n - a.left;
  const act = async (fn, msg) => { setBusy(true); try { const x = await fn(); toast(msg(x)); setHidden((h) => ({ ...h, [a.user_id]: true })); if (onChanged) onChanged(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const shareOut = () => act(() => rpc("team.shareOut", { user_id: a.user_id, today: todayISO() }), (x) => (x.moved ? `Shared ${x.moved} of ${a.name}'s claims: ` + x.to.map((y) => y.name + " " + y.count).join(", ") + "." + (x.left ? ` ${x.left} stayed (nobody in on that client).` : "") : "No untouched claims to share.") + ` ${first} is marked out today.`);
  const markOut = () => act(() => rpc("team.setOut", { user_id: a.user_id, out: true, reason: "Not logged in to Shastra", today: todayISO() }), () => `${a.name} is marked out today. Rebalance on Live status shares their claims equally.`);
  const snooze = () => act(() => rpc("team.alertSnooze", { user_id: a.user_id, minutes: 30 }), () => `We will remind you about ${first} in 30 minutes.`);
  const dismiss = () => act(() => rpc("team.alertDismiss", { user_id: a.user_id }), () => `Noted: no more alerts about ${first} today.`);
  const where = a.clients.length === 1 ? a.clients[0] : "those clients";
  return (
    <div className="overlay miss-pop" role="alertdialog" aria-label={a.name + " has not logged in"}>
      <div className="modal miss-modal">
        <div className="row between top mb"><div><h2>⚠ {a.name} has not logged in</h2><div className="sub">Purview Shastra · checked {clockNow()}{list.length > 1 ? ` · ${Math.min(idx, list.length - 1) + 1} of ${list.length}` : ""}</div></div>
          <button type="button" className="btn icon" title="Remind me in 30 minutes" disabled={busy} onClick={snooze}>✕</button></div>
        <div className="stack" style={{ gap: 10 }}>
          <div>Shift <b>{a.shift || "on the roster"}</b>. It is <b>{clockNow()}</b>, {a.sub}, and there is no punch in, leave, week off or holiday in Shastra. <b>They may be absent.</b></div>
          <div className="card" style={{ margin: 0, padding: "12px 14px" }}>
            {a.n ? <>
              <div><b>{fmtInt(a.n)} claim{a.n === 1 ? "" : "s"}</b> on their desk {a.n === 1 ? "is" : "are"} not started{a.high ? ` (${fmtInt(a.high)} high priority)` : ""}{a.clients.length ? " · " + a.clients.join(", ") : ""}</div>
              {a.plan.length ? <><div className="small muted" style={{ marginTop: 6 }}>Shared equally between the people logged in on {where}, high priority first:</div>
                <div>{a.plan.map((x) => <span key={x.id} className="miss-chip">{x.name} <em>+{x.count}</em></span>)}{a.skipped.map((x) => <span key={x.name} className="miss-chip off">{x.name} · {x.why}</span>)}</div></>
                : <div className="small amber-ink" style={{ marginTop: 6 }}>Nobody on {where} is logged in to share them with yet.</div>}
              {a.left > 0 && a.plan.length > 0 && <div className="tiny muted" style={{ marginTop: 4 }}>{fmtInt(a.left)} stay with {first}: nobody on that client is logged in.</div>}
            </> : <div>No untouched claims on their desk.</div>}
          </div>
          <div className="small muted">Claims {first} already started stay with them. {first} is marked Out today; if they come in later, In after all on Live status gives the day back. The people who get claims are told on their screen.</div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
          {share > 0 && a.plan.length > 0 && <button type="button" className="btn primary" disabled={busy} onClick={shareOut}>Reallocate {fmtInt(share)} claim{share === 1 ? "" : "s"} equally</button>}
          <button type="button" className="btn" disabled={busy} onClick={markOut}>Mark out only</button>
          <button type="button" className="btn" disabled={busy} onClick={snooze}>Remind me in 30 min</button>
          <button type="button" className="btn link" disabled={busy} onClick={dismiss}>They told me · dismiss</button>
          {list.length > 1 && <button type="button" className="btn sm" onClick={() => setIdx((idx + 1) % list.length)}>Next ›</button>}
          <span style={{ flex: 1 }} /><AskComputer />
        </div>
      </div>
    </div>
  );
}
function AllocBanner({ items, onGo, onSeen }) {
  if (!items || !items.length) return null;
  const n = items.reduce((t, x) => t + (x.n || 0), 0);
  const seen = async () => { try { await rpc("notify.seen", { ids: items.map((x) => x.id) }); } catch (e) {} if (onSeen) onSeen(); };
  const why = (t) => { const x = String(t || "").replace(/^\d+ new claims? (were|was) allocated to you:? ?/, ""); return x ? x[0].toUpperCase() + x.slice(1) : ""; };
  return (
    <div className="alloc-note" role="status">
      <div className="ic">🔔</div>
      <div style={{ flex: 1, minWidth: 220 }}><div className="big">{n ? fmtInt(n) + " new claim" + (n === 1 ? " was" : "s were") + " allocated to you" : "New claims were allocated to you"}</div>
        {items.slice(0, 3).map((x) => <div key={x.id} className="small">{why(x.text)} <span className="muted tiny">· {fmtWhen(x.at)}</span></div>)}
        <div className="small muted">They are on your list now, high priority first.</div></div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}><button type="button" className="btn primary" onClick={() => { seen(); onGo("queue"); }}>Open my list</button><button type="button" className="btn" onClick={seen}>OK</button><AskComputer /></div>
    </div>
  );
}
function Shell({ me, view, setView, onSignOut, onChangePassword, onDeleteAccount, attention, handoffs, fb, notify, onGo, onSearch, onRefreshNotify, children }) {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!notify) return;
    for (const a of notify.alerts || []) if (a.popup) tellComputer("miss:" + a.user_id + ":" + a.day, "Brahmastra: " + a.name + " has not logged in", `Shift ${a.shift || ""} · ${a.n} claim${a.n === 1 ? "" : "s"} on their desk. Open Brahmastra to reallocate.`);
    for (const x of notify.alloc_new || []) tellComputer("alloc:" + x.id, "Brahmastra: " + (x.n ? x.n + " new claim" + (x.n === 1 ? "" : "s") : "New claims") + " allocated to you", x.text);
  }, [notify]);
  const [openG, setOpenG] = useState(null);
  const [fbOpen, setFbOpen] = useState(false);
  const nav = navFor(me, handoffs, fb, attention);
  const pageLabel = (navItems(nav).find(([k]) => k === view) || [view, view === "settings" ? "Settings" : view === "digest" ? "Monday digest" : view])[1];
  const navKey = NAV_ALIAS[view] && me.role === "supervisor" ? NAV_ALIAS[view] : view;
  useEffect(() => { document.title = pageLabel + " · Brahmastra"; }, [pageLabel]);
  const allowedViews = [...navItems(nav).map(([k]) => k), ...(me.role === "supervisor" && !deskOf(me, handoffs) ? Object.keys(NAV_ALIAS) : [])];
  useEffect(() => { if (!menu && !openG) return; const h = () => { setMenu(false); setOpenG(null); }; window.addEventListener("click", h); return () => window.removeEventListener("click", h); }, [menu, openG]);
  const navBadge = (k) => (k === "attention" || k === "live") && attention && attention.n > 0 ? <span className={"badge " + (attention.overdue ? "red" : "amber")} style={{ marginLeft: 6 }}>{attention.n}</span>
    : k === "handoffs" && handoffs && handoffs.n > 0 ? <span className={"badge " + (handoffs.overdue ? "red" : "amber")} style={{ marginLeft: 6 }}>{handoffs.n}</span>
    : k === "feedback" && fb && fb.n > 0 ? <span className="badge amber" style={{ marginLeft: 6 }}>{fb.n}</span> : null;
  return (
    <div>
      {DEMO && <div className="banner">Demo mode: the server runs inside this browser and nothing is shared. Set <span className="mono">API_BASE</span> in index.html to go live.</div>}
      <div className="topbar"><div className="topbar-in">
        <Wordmark size={20} tag={deskOf(me, handoffs) ? DESK[deskOf(me, handoffs)].role + (me.role === "supervisor" ? " lead" : "") : roleLabel(me).toLowerCase()} />
        <div className="nav" style={{ flex: 1 }}>{nav.map((e) => Array.isArray(e)
          ? <button key={e[0]} className={navKey === e[0] ? "active" : ""} onClick={() => { setOpenG(null); setView(e[0]); }}>{e[1]}{navBadge(e[0])}</button>
          : <div key={e.g} className="nav-group" onClick={(ev) => ev.stopPropagation()}>
              <button className={e.items.some(([k]) => k === navKey) ? "active" : ""} onClick={() => setOpenG(openG === e.g ? null : e.g)}>{e.g} ▾{openG !== e.g && (e.items.map(([k]) => navBadge(k)).find(Boolean) || null)}</button>
              {openG === e.g && <div className="menu">
                {e.items.map(([k, l]) => <button key={k} className={navKey === k ? "on" : ""} onClick={() => { setOpenG(null); setView(k); }}>{l}{navBadge(k)}</button>)}
              </div>}
            </div>)}</div>
        <div className="top-tools">
        <button type="button" className="btn sm cmdk-btn" onClick={onSearch} title="Search pages, clients, people and claims (Ctrl+K)"><SearchIcon /><span className="cmdk-lbl">Search</span><kbd>Ctrl K</kbd></button>
        <Bell notify={notify} allowed={allowedViews} onGo={onGo} />
        <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
          <button className="btn sm" onClick={() => setMenu(!menu)}><span className="me-name">{me.name || me.email}</span> ▾</button>
          {menu && <div className="menu">
            <div className="small muted" style={{ padding: "6px 10px" }}>{me.email}<br />{roleLabel(me)}{me.access_all ? " · every project" : me.scope_projects && me.scope_projects.length && me.role === "supervisor" ? " · " + me.scope_projects.join(", ") : ""}</div>
            <div className="tiny muted" style={{ padding: "0 10px 6px" }}>{me.designation ? me.designation + " · " : ""}signed in with {me.via === "otp" ? "a code" : "password"}</div>
            <button onClick={() => { setMenu(false); setView("settings"); }}>Settings</button>
            <button onClick={() => { setMenu(false); onSignOut(); }}>Sign out</button>
          </div>}
        </div>
        </div>
      </div></div>
      {attention && attention.overdue > 0 && view !== "attention" && (
        <div className="tat-bar" onClick={() => setView("attention")}>⚠ {attention.overdue} escalated claim{attention.overdue > 1 ? "s have" : " has"} waited more than 24 hours for a team lead. Open Needs attention to answer {attention.overdue > 1 ? "them" : "it"}.</div>
      )}
      {handoffs && handoffs.overdue > 0 && view !== "handoffs" && (
        <div className="tat-bar" onClick={() => setView("handoffs")}>⚠ {handoffs.overdue} posting / submission hand-off{handoffs.overdue > 1 ? "s are" : " is"} past the TAT. Open Posting &amp; submission to complete {handoffs.overdue > 1 ? "them" : "it"} or ask for assistance.</div>
      )}
      {handoffs && !handoffs.overdue && handoffs.due_soon > 0 && view !== "handoffs" && (
        <div className="tat-bar soon" onClick={() => setView("handoffs")}>⏱ {handoffs.due_soon} posting / submission hand-off{handoffs.due_soon > 1 ? "s have" : " has"} under 4 hours left on the TAT. Open {(DESK[deskOf(me, handoffs)] || { tab: "Posting & submission" }).tab} to finish {handoffs.due_soon > 1 ? "them" : "it"} on time.</div>
      )}
      {me.role === "supervisor" && notify && <MissingAlertPopup alerts={notify.alerts} onChanged={onRefreshNotify} />}
      <div className="main">{notify && (notify.alloc_new || []).length > 0 && view !== "settings" && <AllocBanner items={notify.alloc_new} onGo={onGo} onSeen={onRefreshNotify} />}{children}</div>
      <button type="button" className="fb-tab" onClick={() => setFbOpen(true)} title="Tell Shreya and Sweety what is wrong or what would help, with a screenshot">Feedback</button>
      {fbOpen && <FeedbackModal page={pageLabel} onClose={() => setFbOpen(false)} />}
    </div>
  );
}


/* ====================================================================
   PART 3 — supervisor screens
   ==================================================================== */
/* Claims whose follow-up date passed with no new entry: hand them to a biller again, all at once. */
function OverdueModal({ ctx, clientId, locId, onClose, onChanged }) {
  const q = useRpc("claims.list", { client_id: clientId || undefined, location_id: locId || undefined, overdue: true, sort: "follow_up_on", dir: "asc", page_size: 500 }, []);
  const rows = q.data ? q.data.rows : [];
  const [sel, setSel] = useState(null);
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = sel || new Set(rows.map((r) => r.id));
  const toggle = (id) => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const assign = async () => {
    setBusy(true);
    try { const r = await rpc("alloc.reassign", { ids: [...chosen], user_id: user }); toast(`${fmtInt(r.changed)} claims assigned.`); onChanged(); onClose(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const billers = ctx.users.filter((u) => u.active);
  return (
    <Modal title="Overdue follow-ups" sub="The follow-up date passed and nobody has made a new entry. Pick who works them; they go to the top of that person's list." onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><div className="row"><Combo sm width={240} value={user} onChange={setUser} placeholder="Assign to…" options={billers.map((u) => ({ id: u.id, label: u.name + (u.role === "supervisor" ? " (TL)" : "") }))} /><button className="btn primary" disabled={busy || !user || !chosen.size} onClick={assign}>{busy ? "Assigning…" : `Assign ${fmtInt(chosen.size)} claims`}</button></div></>}>
      <ErrorBox error={q.error} />
      {!q.data && !q.error && <Spinner />}
      {q.data && (
        <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t"><thead><tr><th><input type="checkbox" checked={chosen.size === rows.length && rows.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th><th>Claim #</th><th>Patient</th><th>Payer</th><th className="r">Balance</th><th>Follow-up was</th><th>Last entry</th><th>Last worked by</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><input type="checkbox" checked={chosen.has(r.id)} onChange={() => toggle(r.id)} /></td><td className="mono small">{r.claim_no || "–"}</td><td>{r.patient}<div className="tiny muted">{r.location_name || ""}</div></td><td className="small">{r.payer}</td><td className="num">{fmtMoney(r.balance)}</td><td className="small" style={{ color: "var(--red-ink)" }}>{fmtDate(r.follow_up_on)}</td><td className="small">{r.last_status_code}{r.last_sub_status ? <div className="tiny muted">{r.last_sub_status}</div> : null}</td><td className="small">{r.assigned_name || "–"}</td></tr>)}
            {!rows.length && <tr><td colSpan={8}><Empty>No overdue follow-ups.</Empty></td></tr>}</tbody></table></div>
      )}
    </Modal>
  );
}
/* Every claim of one patient on one screen, so one call to the payer or the patient covers all of them. */
function PatientModal({ id, ctx, me, onClose, onOpenClaim }) {
  const q = useRpc("claims.byPatient", { id }, [id]);
  const rows = q.data ? q.data.rows : [];
  const open = rows.filter((r) => ["open", "assigned", "in_progress", "completed"].includes(r.state));
  return (
    <Modal title={q.data ? q.data.patient || "Patient" : "Patient"} sub={q.data ? `${q.data.account_no ? "Account " + q.data.account_no + " · " : ""}${fmtInt(open.length)} open claims · ${fmtMoney(sum(open, (r) => r.balance))} · one call can cover them all` : ""} onClose={onClose} wide>
      <ErrorBox error={q.error} />
      {!q.data && !q.error && <Spinner />}
      {q.data && (
        <div className="table-wrap" style={{ maxHeight: 480 }}><table className="t"><thead><tr><th>Claim #</th><th>DOS</th><th>CPT</th><th>Payer</th><th>Provider</th><th className="r">Balance</th><th className="r">Age</th><th>File status</th><th>Last SAAG entry</th><th>Follow-up</th><th>State</th><th>With</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className={"click " + workTone(r)} onClick={() => onOpenClaim && onOpenClaim(r)} title={r.last_note || ""}>
            <td className="mono small">{r.claim_no || "–"}</td><td className="small">{fmtDate(r.dos)}</td><td className="mono small">{r.cpt}</td><td className="small">{r.payer}</td><td className="small">{r.provider}</td><td className="num">{fmtMoney(r.balance)}</td><td className="num">{r.age_days ?? "–"}</td>
            <td className="small">{r.file_status}{r.file_sub_status ? <div className="tiny muted">{r.file_sub_status}</div> : null}</td>
            <td className="small">{r.last_status_code ? <><b>{r.last_status_code}</b>{r.last_sub_status ? <div className="tiny muted">{r.last_sub_status}</div> : null}<div className="tiny muted">{r.last_action_code}{r.last_worked_on ? " · " + fmtDate(r.last_worked_on) : ""}</div></> : <span className="muted">not worked yet</span>}</td>
            <td className="small">{r.follow_up_on ? fmtDate(r.follow_up_on) : ""}</td><td><StateBadge state={r.state} /></td><td className="small">{r.mine ? "you" : r.assigned_name || "–"}</td></tr>)}
            {!rows.length && <tr><td colSpan={12}><Empty>No other claims for this patient.</Empty></td></tr>}</tbody></table></div>
      )}
      <div className="tiny muted mt8">Green: closed · yellow: worked and still open · white: not worked yet. Click a claim on your desk to open it.</div>
    </Modal>
  );
}
/* Time on calls, from the call start / end times billers enter for calls. Without a date range it shows today. */
const fmtMins = (m) => { m = Math.round(Number(m) || 0); const h = Math.floor(m / 60); return h ? h + " h " + (m % 60) + " min" : m + " min"; };
function CallTimeCard({ clientId, locId, rangeMs, rangeLabel }) {
  const span = rangeMs || { from_ms: dayBounds(todayISO())[0], to_ms: dayBounds(todayISO())[1] };
  const q = useRpc("supervisor.callTime", { client_id: clientId || undefined, location_id: locId || undefined, ...span }, [clientId, locId, JSON.stringify(span)]);
  const sortU = useTableSort("minutes", "desc");
  const d = q.data, tot = (d && d.total) || { calls: 0, minutes: 0, people: 0 };
  return (
    <div className="card">
      <div className="row between"><h3>Time on calls · {rangeMs ? rangeLabel : "today"}</h3><span className="tiny muted">from the call start and end times billers enter when the source is Call</span></div>
      <ErrorBox error={q.error} />
      <div className="grid g4 mt8">
        <Kpi label="Total call time" value={fmtMins(tot.minutes)} tone="accent" />
        <Kpi label="Calls" value={fmtInt(tot.calls)} sub={fmtInt(tot.people) + (tot.people === 1 ? " person" : " people")} />
        <Kpi label="Average per call" value={tot.calls ? fmtMins(tot.minutes / tot.calls) : "–"} />
        <Kpi label="Average per person" value={tot.people ? fmtMins(tot.minutes / tot.people) : "–"} />
      </div>
      {d && tot.calls > 0 && <div className="grid g2 mt8">
        <div className="table-wrap"><table className="t"><thead><tr>{sortU.Th("user_name", "Team member")}{sortU.Th("calls", "Calls", "r")}{sortU.Th("minutes", "Call time", "r")}<th className="r">Average</th>{sortU.Th("longest", "Longest", "r")}</tr></thead>
          <tbody>{sortU.sortRows(d.by_user).map((r) => <tr key={r.user_id}><td>{r.user_name}</td><td className="num">{fmtInt(r.calls)}</td><td className="num">{fmtMins(r.minutes)}</td><td className="num">{fmtMins(r.minutes / r.calls)}</td><td className="num">{fmtMins(r.longest)}</td></tr>)}</tbody></table></div>
        <div className="table-wrap"><table className="t"><thead><tr><th>Payer</th><th className="r">Calls</th><th className="r">Call time</th><th className="r">Average</th></tr></thead>
          <tbody>{d.by_payer.map((r) => <tr key={r.payer}><td>{r.payer}</td><td className="num">{fmtInt(r.calls)}</td><td className="num">{fmtMins(r.minutes)}</td><td className="num">{fmtMins(r.minutes / r.calls)}</td></tr>)}</tbody></table></div>
      </div>}
      {d && !tot.calls && <div className="small muted mt8">No calls with start and end times in this period yet.</div>}
    </div>
  );
}
/* The Payment posting / Submission dashboard (their team leads land here): what came in, what was done, within TAT,
   by day, client and person. */
function DeskDashboard({ ctx, desk, go }) {
  const [dr, setDr] = useState(() => newRange("month"));
  const [clientId, setClientId] = useState("");
  const [from, to] = rangeSpan(dr);
  const payload = { dept: desk, client_id: clientId || undefined, from_ms: dayBounds(from)[0], to_ms: dayBounds(to)[1] };
  const q = useRpc("handoffs.dashboard", payload, [JSON.stringify(payload)]);
  const d = q.data, t = (d && d.totals) || {};
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "–");
  const hrs = (h) => (h == null ? "–" : h < 1 ? Math.round(h * 60) + " min" : (Math.round(h * 10) / 10) + " h");
  const maxDay = Math.max(1, ...((d && d.by_day) || []).map((x) => Math.max(x.received, x.done)));
  const label = DESK[desk].tab, verb = desk === "posting" ? "posted" : desk === "submission" ? "submitted" : "completed";
  return (
    <div className="stack">
      <div className="row between top">
        <div><h1>{label} dashboard</h1><div className="sub">What billers and AR team leads sent to {label}, what was {verb}, and how much within {d && d.tat_varies ? "each client's" : "the " + (d ? d.tat_hours : 24) + "-hour"} TAT.</div></div>
        <div className="row" style={{ alignItems: "flex-end" }}><div style={{ minWidth: 220 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} allowAll /></div><DateRange value={dr} onChange={setDr} /></div>
      </div>
      <ErrorBox error={q.error} />
      {q.loading && !d && <Spinner />}
      {d && <>
        <div className="grid g4">
          <Kpi label="Received" value={fmtInt(t.received || 0)} sub={"sent to " + label + ", " + rangeText(dr)} tone="accent" />
          <Kpi label={desk === "posting" ? "Posted" : desk === "submission" ? "Submitted" : "Completed"} value={fmtInt(t.completed || 0)} sub={(desk === "posting" ? fmtMoney(t.amount || 0) + " balance posted" : fmtInt(t.rejected || 0) + " rejected on recheck") + " · " + fmtInt(t.back || 0) + " back to AR"} tone="good" />
          <Kpi label="Within TAT" value={pct(t.met || 0, t.done || 0)} sub={"average " + hrs(t.avg_hours) + " to complete"} tone={t.done && t.met / t.done < 0.9 ? "warn" : undefined} />
          <Kpi label="Open now" value={fmtInt(t.open_now || 0)} sub={fmtInt(t.overdue_now || 0) + " past TAT · " + fmtInt(t.assist || 0) + " needed assistance"} tone={t.overdue_now ? "bad" : undefined} />
        </div>
        {t.overdue_now > 0 && <div className="alert err row between"><span><b>{t.overdue_now} past the TAT.</b> Answer these first.</span><button className="btn sm" onClick={() => go("handoffs")}>Open {label}</button></div>}
        <div className="grid g2-1">
          <div className="card"><h3>By day</h3><div className="small muted mb">Received and {verb}, {rangeText(dr)}</div>
            {d.by_day.length ? <div className="stack" style={{ gap: 6 }}>{d.by_day.map((x) => <div key={x.day} className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
              <span className="small" style={{ width: 86 }}>{fmtDate(x.day)}</span>
              <div style={{ flex: 1 }}><div className="bar" style={{ height: 7 }}><i style={{ width: (100 * x.received) / maxDay + "%", background: "var(--blue)" }} /></div><div className="bar mt8" style={{ height: 7, marginTop: 3 }}><i style={{ width: (100 * x.done) / maxDay + "%" }} /></div></div>
              <span className="small num" style={{ width: 90, textAlign: "right" }}>{x.received} in · {x.done} out</span></div>)}
              <div className="tiny muted"><span style={{ color: "var(--blue)" }}>■</span> received · <span style={{ color: "var(--teal)" }}>■</span> {verb}</div></div> : <Empty>Nothing in these dates.</Empty>}</div>
          <div className="card"><h3>By person</h3><div className="table-wrap mt8"><table className="t"><thead><tr><th>Who</th><th className="r">{desk === "posting" ? "Posted" : desk === "submission" ? "Submitted" : "Completed"}</th><th className="r">Within TAT</th><th className="r">Average</th><th className="r">Open</th></tr></thead>
            <tbody>{d.by_person.map((p) => <tr key={p.name}><td><b>{p.name}</b></td><td className="num" title={fmtInt(p.done) + " handled in all (completed, back to AR, assistance, rejected)"}>{fmtInt(p.completed)}</td><td className="num">{pct(p.met, p.done)}</td><td className="num">{hrs(p.avg_hours)}</td><td className="num">{fmtInt(p.open_now)}</td></tr>)}
              {!d.by_person.length && <tr><td colSpan={5} className="muted">Nobody yet.</td></tr>}</tbody></table></div></div>
        </div>
        <div className="card"><h3>By client</h3><div className="table-wrap mt8"><table className="t"><thead><tr><th>Client</th><th className="r">Received</th><th className="r">{desk === "posting" ? "Posted" : desk === "submission" ? "Submitted" : "Completed"}</th><th className="r">Within TAT</th><th className="r">Open now</th><th className="r">Past TAT</th></tr></thead>
          <tbody>{d.by_client.map((c) => <tr key={c.client_name}><td><b>{c.client_name}</b></td><td className="num">{fmtInt(c.received)}</td><td className="num">{fmtInt(c.completed)}</td><td className="num">{pct(c.met, c.done)}</td><td className="num">{fmtInt(c.open_now)}</td><td className="num">{c.overdue_now ? <span className="badge red">{c.overdue_now}</span> : "0"}</td></tr>)}
            {!d.by_client.length && <tr><td colSpan={6} className="muted">Nothing sent to {label} yet.</td></tr>}</tbody></table></div></div>
        <div className="card"><div className="row between"><h3>Needs you now</h3><span className="tiny muted">past the TAT · under {d.due_soon_hours} hours left · client not answered in 3 working days · returned {d.bounce_limit}+ times</span></div>
          <div className="table-wrap mt8"><table className="t"><thead><tr><th>Why</th><th>Claim</th><th>Client</th><th>With</th><th>Due</th></tr></thead>
            <tbody>{d.attention.map((x) => <tr key={x.id}><td>{{ past: <span className="badge red">Past TAT</span>, soon: <span className="badge amber">Under {d.due_soon_hours} h left</span>, chase: <span className="badge red">Chase the client</span>, bounced: <span className="badge red">Returned {x.returns}×</span> }[x.why]}{x.returns > 0 && x.why !== "bounced" ? <span className="badge amber" style={{ marginLeft: 4 }}>returned {x.returns}×</span> : null}</td>
              <td><span className="mono small">{x.claim_no || "–"}</span><div className="tiny muted">{x.patient} · {DEPT_NAME[x.dept]}</div></td><td className="small">{x.client_name}</td><td className="small">{x.who || "–"}</td><td className="small">{fmtWhen(x.due_at)}</td></tr>)}
              {!d.attention.length && <tr><td colSpan={5} className="muted">Nothing urgent. Everything is on time.</td></tr>}</tbody></table></div></div>
        <div className="grid g2">
          <div className="card"><h3>Why claims needed AR's help</h3><div className="small muted mb">Need assistance from AR, {rangeText(dr)}, by reason</div>
            {d.back_reasons.length ? <Bars rows={d.back_reasons} labelOf={(r) => r.reason || "No reason"} valueOf={(r) => r.n} fmt={fmtInt} /> : <Empty>Nothing came back to AR in these dates.</Empty>}</div>
          <div className="card"><h3>…and from which biller</h3><div className="small muted mb">Coaching points: who sends claims that come back</div>
            <div className="table-wrap"><table className="t"><thead><tr><th>Biller</th><th className="r">Returned</th><th>Reasons</th></tr></thead>
              <tbody>{d.back_billers.map((b) => <tr key={b.biller}><td><b>{b.biller || "–"}</b></td><td className="num">{fmtInt(b.n)}</td><td className="small">{String(b.reasons || "").split(",").join(" · ")}</td></tr>)}
                {!d.back_billers.length && <tr><td colSpan={3} className="muted">Nobody.</td></tr>}</tbody></table></div></div>
        </div>
        {desk !== "posting" && <div className="card"><div className="row between"><h3>Rejections by code</h3><span className="small muted">{fmtInt(d.rejections.total)} rejection{d.rejections.total === 1 ? "" : "s"} recorded, {rangeText(dr)}</span></div>
          {d.rejections.total ? <div className="grid g3 mt8">
            {[["by_code", "What was wrong"], ["by_client", "By client"], ["by_biller", "By biller who sent it"]].map(([k, l]) => <div key={k}><div className="hub-l b small mb">{l}</div><Bars rows={d.rejections[k]} labelOf={(r) => r.name} valueOf={(r) => r.n} fmt={fmtInt} /></div>)}
          </div> : <Empty>No rejections recorded in these dates. They are counted when a recheck is marked Rejected, or a Rejections hand-off is resubmitted with its code.</Empty>}</div>}
      </>}
    </div>
  );
}
/* ---------- Live status: what everyone is working on right now ----------
   Its own tab after Sasha's Third Eye. The live floor (who is in, on which claim and for how long, pace, left over split
   into high priority and other), what is waiting on this person, and the claims waiting to be worked. Refreshes every
   30 seconds; managers and above can narrow it to one team lead. */
function LiveStatusView({ ctx, me, go, params }) {
  const p = params || {};
  const [clientId, setClientId] = useState(p.clientId || p.client_id || "");
  const [locId, setLocId] = useState(p.locationId || "");
  const [leadId, setLeadId] = useState("");
  const leadsQ = useRpc("team.leads", {}, []);
  const canLead = !!(leadsQ.data && leadsQ.data.can_pick_lead && leadsQ.data.leads.length);
  const base = { client_id: clientId || undefined, location_id: locId || undefined, lead_id: leadId || undefined };
  const live = useRpc("team.huddle", base, [clientId, locId, leadId]);
  const stats = useRpc("claims.stats", base, [clientId, locId, leadId]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") { live.reload(); stats.reload(); } }, 30000); return () => clearInterval(t); }, [clientId, locId, leadId]);
  const t = (live.data && live.data.totals) || {}, d = stats.data;
  const st = (k) => (d && d.states.find((x) => x.state === k)) || { n: 0, amt: 0 };
  const stamp = new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const openClaims = (extra) => go("claims", { clientId, locationId: locId, ...extra });
  return (
    <div className="stack">
      <div className="row between top"><div><h1>Live status</h1><div className="sub">What everyone is working on right now, and the claims on their desks.</div></div><span className="small muted">{stamp}</span></div>
      <div className="row dash-filters" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div style={{ minWidth: 220 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={(v) => { setClientId(v); setLocId(""); }} allowAll /></div>
        {clientId && <div style={{ minWidth: 180 }}><LocationPicker ctx={ctx} clientId={clientId} locId={locId} setLocId={setLocId} /></div>}
        {canLead && <div style={{ minWidth: 210 }}><Field label="Team lead"><Combo value={leadId} onChange={setLeadId} placeholder="All team leads"
          options={leadsQ.data.leads.map((l) => ({ id: l.id, label: l.name + " · " + plural(l.n, "biller") }))} /></Field></div>}
        <span className="badge teal live-badge">● Live · refreshes every 30 seconds</span>
      </div>
      <NeedsStrip go={go} />
      {live.data && live.data.rows.length > 0 && <div className="grid dash-k6">
        <Kpi tone="accent" label="In today" value={(live.data.weekend ? t.in_weekend : t.people - t.out) + " of " + t.people} sub={live.data.weekend ? "weekend, nobody is expected in" : t.out ? plural(t.out, "person", "people") + " out" : "everyone in"} />
        <Kpi label="Working now" value={<span className="teal-ink">{fmtInt(t.working)}</span>} sub="a claim open or entries in the last 30 minutes" />
        <Kpi label="Idle now" value={<span className={t.idle ? "red-ink" : ""}>{t.idle}</span>} sub="no entry for 30 minutes" />
        <Kpi label="Worked today" value={fmtInt(t.worked)} sub={live.data.weekend ? "no target at the weekend" : "of " + fmtInt(t.capacity) + " target"} />
        <Kpi label="Closed today" value={<span className="teal-ink">{fmtInt(t.closed)}</span>} sub="worked to closed" tone="good" />
        <Kpi label="Left over" value={<span className={t.carried ? "amber-ink" : ""}>{fmtInt(t.carried)}</span>} sub={t.carried ? <><span className="red-ink b">{fmtInt(t.left_high)} high priority</span> · {fmtInt(t.carried - t.left_high)} other</> : "allocated before this shift, all worked"} />
      </div>}
      <LiveFloor ctx={ctx} me={me} go={go} q={live} clientId={clientId} locId={locId} grouped={canLead && !leadId} filtered={!!(clientId || leadId)} />
      {d && <div className="grid g3">
        <Kpi label="Unassigned" value={fmtInt(st("open").n)} sub={fmtMoney(st("open").amt) + " waiting for allocation"} onClick={() => openClaims({ state: "open" })} />
        <Kpi label="With Posting / Submission" value={fmtInt(st("in_process").n)} sub={fmtMoney(st("in_process").amt) + " in process"} onClick={() => openClaims({ state: "in_process" })} />
        <Kpi label="Follow-ups due today" value={<span className={d.follow_ups_due && d.follow_ups_due.n ? "amber-ink" : ""}>{fmtInt(d.follow_ups_due ? d.follow_ups_due.n : 0)}</span>} sub={fmtInt(d.overdue ? d.overdue.n : 0) + " overdue"} onClick={() => openClaims({ follow_up_due: true })} />
      </div>}
    </div>
  );
}
/* ---------- Dashboard: Team status, Inventory status and the Client 360 report ---------- */
const DASH_TABS = [["team", "Team status"], ["inventory", "Inventory status"], ["report", "Client 360 report"]];
// an old Dashboard › Client reports or Portfolio link opens Inventory status
const dashTab = (x) => { const t = x && x.tab; return t === "inventory" || t === "clients" || t === "client" || t === "portfolio" ? "inventory" : t === "report" ? "report" : "team"; };
function DashboardHub(props) {
  const { params } = props;
  const [tab, setTab] = useState(() => dashTab(params));
  useEffect(() => { if (params && params.tab) setTab(dashTab(params)); }, [params && params.tab]);
  const stamp = new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const SUB = { team: "Team status: production and training, attainment and time on floor, for the dates picked.",
    inventory: "Inventory status: where every claim stands today, and what to work first to meet the SLA this month.",
    report: "Client 360 report: the client's report pack, filled from Brahmastra, to present or send as one PDF." };
  return (
    <div className="stack">
      <div className="row between top"><div><h1>Dashboard</h1><div className="sub">{SUB[tab]}</div></div><span className="small muted">{stamp}</span></div>
      <div className="seg2 dash-subtabs" role="tablist" style={{ alignSelf: "flex-start" }}>{DASH_TABS.map(([k, l]) =>
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "team" ? <TeamStatusTab {...props} /> : tab === "inventory" ? <InventoryStatusTab {...props} /> : <DashClientReport {...props} />}
    </div>
  );
}
/* Dashboard › Client 360 report: pick the client, then its report studio (what Client 360 › Client report was). */
function DashClientReport({ ctx, me, go, params }) {
  const active = ctx.clients.filter((c) => c.active);
  const [cid, setCid] = useState(() => { const want = (params && params.client_id) || c360Last(); return active.some((c) => c.id === want) ? want : (active[0] || {}).id || ""; });
  useEffect(() => { if (params && params.client_id && active.some((c) => c.id === params.client_id)) setCid(params.client_id); }, [params && params.client_id]);
  useEffect(() => { try { if (cid) localStorage.setItem("brahmastra:c360", cid); } catch (e) {} }, [cid]);
  if (!active.length) return <div className="card"><Empty>No clients in your span yet.</Empty></div>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row no-print dash-client" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ minWidth: 280 }}><Combo value={cid} onChange={(v) => v && setCid(v)} clearable={false} options={active.map((c) => ({ id: c.id, label: c.name + (c.code ? " (" + c.code + ")" : "") }))} /></span>
        <button className="btn sm" onClick={() => go("client", { client_id: cid })} title="Everything about this client: health, AR, month-end, call log">Open Client 360</button>
      </div>
      {cid && <ClientReportStudio ctx={ctx} me={me} go={go} clientId={cid} />}
    </div>
  );
}
const fmtHM = (m) => { if (m == null) return "–"; m = Math.round(m); const h = Math.floor(m / 60), mm = m % 60; return h ? h + " h" + (mm ? " " + String(mm).padStart(2, "0") + " m" : "") : mm + " m"; };
const TS_STATUS_TONE = { Production: "green", Training: "blue", OJT: "blue", "Serving notice": "amber", Sabbatical: "gray" };
const rampCell = (r) => { const x = r.ramp || {}; if (x.kind === "prod") return <span className="badge green">In production</span>; if (x.kind !== "ramp") return <span className="badge gray">{r.status}</span>;
  if (x.flag === "nodate") return <span className="badge gray">No start date</span>;
  const ext = x.extended ? " · date agreed" : "";
  const md = (d) => { try { return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); } catch { return d; } };
  if (x.flag === "over") return <span className="badge red" title={"Was due in production " + fmtDate(x.due)}>Overdue · +{-x.days}d</span>; if (x.flag === "soon") return <span className="badge amber" title={"Due in production " + fmtDate(x.due)}>Due {md(x.due)} · {x.days}d left{ext}</span>;
  return <span className="badge gray" title={"Due in production " + fmtDate(x.due)}>Due {md(x.due)} · {x.extended ? "date agreed" : "on track"}</span>; };
const PERF_BADGE = { below: ["red", "Below the mark"], ok: ["green", "Meeting the mark"], ramp: ["blue", "In ramp-up"], pending: ["gray", "Day under way"], none: ["gray", "No entries yet"] };
const perfCell = (r, mark) => { const b = PERF_BADGE[r.perf]; if (!b) return <span className="muted">–</span>;
  const tip = r.perf === "ramp" ? "Training and OJT are not judged against the production mark" : r.perf === "pending" ? "Judged once the day is finished" : r.perf === "below" ? "Under " + mark + "% attainment" : "";
  return <span className={"badge " + b[0]} title={tip}>{b[1]}</span>; };
const attainStamp = (v) => v == null ? <span className="muted">–</span> : <span className={"stamp " + (v >= 95 ? "good" : v >= 80 ? "warn" : "bad")}>{v}%</span>;
/* On floor and Idle on Team status, from Purview Shastra: met or short on the finished days; idle is Shastra Guard's no
   movement plus screen locked while punched in, breaks left out. */
const FLOOR_SRC = { off: "Purview Shastra is not connected", not_set_up: "waiting for the floor-time feed in Purview Shastra", error: "Purview Shastra did not answer", pending: "from Purview Shastra" };
const floorCell = (r, src) => {
  if (r.on_floor_min == null) return <span className="muted" title={r.floor === "no_attendance" ? "No attendance in Purview Shastra for these dates" : FLOOR_SRC[src] || ""}>–{r.floor === "no_attendance" ? <div className="tiny">no attendance</div> : null}</span>;
  const sub = r.floor === "met" ? <div className="tiny teal-ink">met</div> : r.floor === "short" ? <div className={"tiny " + (r.on_floor_done_min < r.floor_needed_done_min * 0.75 ? "red-ink" : "amber-ink")}>short {fmtHM(r.floor_short_min)}</div> : r.floor === "pending" ? <div className="tiny muted">day under way</div> : null;
  return <span title={r.floor === "pending" ? "Judged once the day is finished" : "On the finished days: " + fmtHM(r.on_floor_done_min) + " of " + fmtHM(r.floor_needed_done_min) + " needed"}>{fmtHM(r.on_floor_min)}{sub}</span>; };
const breakCell = (r) => {
  if (r.break_min == null) return <span className="muted">–</span>;
  const avg = r.break_days ? Math.round(r.break_min / r.break_days) : 0;
  return <span title={"Breaks taken on " + plural(r.break_days, "day") + " with floor time (Purview Shastra allows 60 minutes a day)"}>{fmtHM(r.break_min)}
    {r.break_days ? <div className={"tiny " + (r.break_over_days ? "amber-ink" : "muted")}>{avg} m a day{r.break_over_days ? " · " + r.break_over_days + (r.break_over_days === 1 ? " day" : " days") + " over 1 h" : ""}</div> : null}</span>; };
const idleCell = (r) => {
  if (r.idle_min == null) return <span className="muted" title={r.on_floor_min != null && !r.guard ? "No Shastra Guard machine linked to this person" : ""}>–{r.on_floor_min != null && !r.guard ? <div className="tiny">no Guard</div> : null}</span>;
  const pct = r.on_floor_min ? Math.round(r.idle_min / r.on_floor_min * 100) : 0;
  return <span title={"No movement " + fmtHM(r.idle_min - (r.locked_min || 0)) + " · screen locked " + fmtHM(r.locked_min || 0) + " (Shastra Guard, while punched in, breaks left out)"}>{fmtHM(r.idle_min)}{r.on_floor_min ? <div className={"tiny " + (pct >= 10 && r.idle_min >= 60 ? "amber-ink" : "muted")}>{pct}% of floor</div> : null}</span>; };
/* Dashboard > Team status: Sasha's Third Eye's Team Status, from Brahmastra's own data and the Purview Shastra roster.
   Time on floor and idle time come from Purview Shastra once its feed sends them. */
function TeamStatusTab({ ctx, me, go }) {
  const [clientId, setClientId] = useState(""), [locId, setLocId] = useState(""), [leadId, setLeadId] = useState("");
  const [range, setRange] = useState(() => newRange("week"));
  const span = rangeSpan(range);
  const leadsQ = useRpc("team.leads", {}, []);
  const canLead = !!(leadsQ.data && leadsQ.data.can_pick_lead && leadsQ.data.leads.length);
  const q = useRpc("team.status", { client_id: clientId || undefined, location_id: locId || undefined, lead_id: leadId || undefined, from: span && span[0], to: span && span[1] },
    [clientId, locId, leadId, span && span[0], span && span[1]], !!(span && span[0]));
  const d = q.data, rows = (d && d.rows) || [], t = (d && d.totals) || {};
  const [closed, setClosed] = useState({});
  const [edit, setEdit] = useState(null);
  const [alloc, setAlloc] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await rpc("team.saveNote", { user_id: edit.r.id, start_date: edit.start || "", end_date: edit.end || "", comment: edit.comment || "" }); toast("Saved for " + edit.r.name + "."); setEdit(null); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const groups = groupByLead(rows, true);
  const word = rangeText(range).toLowerCase();
  const sg = (d && d.suggestions) || { today: [], week: [], good: [] };
  const copy = async () => {
    const block = (title, list) => list.length ? title + "\n" + list.map((x) => "- " + x.who + (x.lead ? " (" + x.lead + ")" : "") + ": " + x.seen + ". " + x.do).join("\n") : "";
    const text = ["Team status, " + word, block("Do today", sg.today), block("This week", sg.week), block("Keep going", sg.good)].filter(Boolean).join("\n\n");
    try { await navigator.clipboard.writeText(text); toast("Copied: paste it into your 1:1 notes."); } catch (e) { toast("Could not copy here; select the text instead.", "err"); }
  };
  const csv = () => {
    const head = ["Team lead", "Associate", "DOJ", "Status", "Ramp-up / plan", "Attainment %", "Attainment counted on", "Entries", "Target", "Performance", "Floor time needed (h)", "On floor (h)", "Floor time met", "Idle (h)", "Of it screen locked (h)", "Breaks (h)", "Days over 1 h of breaks", "Left over", "Of them high priority", "Start", "Due in production / plan end", "Comment"];
    const rampTxt = (x) => x.kind === "prod" ? "In production" : x.kind !== "ramp" ? "" : !x.due ? "No start date" : (x.flag === "over" ? "Overdue, was due " : "Due ") + x.due + (x.extended ? " (date agreed)" : "");
    const line = (r) => [r.lead_name, r.name, r.doj, r.status, rampTxt(r.ramp) || r.status, r.attain == null ? "" : r.attain, r.attain == null ? "" : r.attain_basis === "done" ? "days up to yesterday" : "today",
      r.worked, r.target, (PERF_BADGE[r.perf] || ["", ""])[1], Math.round(r.floor_needed_min / 6) / 10,
      r.on_floor_min == null ? "" : Math.round(r.on_floor_min / 6) / 10, r.floor === "met" ? "Met" : r.floor === "short" ? "Short " + Math.round(r.floor_short_min / 6) / 10 + " h" : r.floor === "pending" ? "Day under way" : r.floor === "no_attendance" ? "No attendance in Shastra" : "",
      r.idle_min == null ? "" : Math.round(r.idle_min / 6) / 10, r.locked_min == null ? "" : Math.round(r.locked_min / 6) / 10, r.break_min == null ? "" : Math.round(r.break_min / 6) / 10, r.break_min == null ? "" : r.break_over_days, r.left, r.left_high, r.start_date, r.end_date, r.comment];
    downloadText(toCSV(rows, head.map((label, i) => ({ label, get: (r) => line(r)[i] }))), "Team status " + (span ? span[0] + " to " + span[1] : "") + ".csv");
  };
  const Sugg = ({ tone, title, list }) => { const people = []; for (const x of list) { let pp = people.find((y) => y.user_id === x.user_id); if (!pp) { pp = { user_id: x.user_id, who: x.who, lead: x.lead, items: [] }; people.push(pp); } pp.items.push(x); }
    return <div><div className={"sg-h " + tone}>{title} · {people.length}</div>
    {people.length ? <ul className="sg-list">{people.map((x) => <li key={x.user_id} className="sg"><span className={"sgdot " + tone} /><div>
      <div><button type="button" className="btn link biller-link" style={{ padding: 0 }} onClick={() => go("claims", { assigned_to: x.user_id, state: "" })}>{x.who}</button>{x.lead ? <span className="tiny muted"> · {x.lead}</span> : null}</div>
      {x.items.map((it, i) => <div key={i} className={i ? "mt8" : ""}><div className="small muted">{it.seen}</div><div className="sgdo">→ {it.do}</div></div>)}</div></li>)}</ul> : <div className="small muted" style={{ padding: "4px 10px" }}>Nothing here.</div>}</div>; };
  return (
    <div className="stack">
      {alloc && span && <Modal title={"Allocations · " + alloc.name} sub={"Allocated and worked, " + word + ". The same list My day & reports had."} wide onClose={() => setAlloc(null)}>
        <TeamDesk ctx={ctx} from={span[0]} to={span[1]} rangeLabel={word} fixedUser={alloc.id} /></Modal>}
      <div className="row dash-filters" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div style={{ minWidth: 220 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={(v) => { setClientId(v); setLocId(""); }} allowAll /></div>
        {clientId && <div style={{ minWidth: 180 }}><LocationPicker ctx={ctx} clientId={clientId} locId={locId} setLocId={setLocId} /></div>}
        {canLead && <div style={{ minWidth: 210 }}><Field label="Team lead"><Combo value={leadId} onChange={setLeadId} placeholder="All team leads"
          options={leadsQ.data.leads.map((l) => ({ id: l.id, label: l.name + " · " + plural(l.n, "biller") }))} /></Field></div>}
        <DateRange value={range} onChange={setRange} />
      </div>
      <ErrorBox error={q.error} />
      {!d && !q.error ? <Spinner label="Loading…" /> : d && !rows.length ? <div className="card"><Empty>Nobody here for this selection.</Empty></div> : d && <>
        {d.floor_error && d.floor_source === "ok" && <div className="small muted">Purview Shastra did not answer just now ({d.floor_error}); on floor and idle show the last figures it sent.</div>}
        {t.ramp_over > 0 && <div className="alert" style={{ background: "var(--red-soft)", borderColor: "rgba(201,79,79,.35)" }}><b className="red-ink">{plural(t.ramp_over, "person", "people")} past their ramp-up date:</b> {rows.filter((r) => r.ramp.flag === "over").map((r) => r.name + " (+" + (-r.ramp.days) + "d)").join(", ")}</div>}
        <div className="grid dash-k6">
          <Kpi tone="accent" label="Headcount" value={fmtInt(t.people)} sub={plural(t.leads, "team lead")} />
          <Kpi label="In production" value={<span className="teal-ink">{fmtInt(t.production)}</span>} sub={t.people ? Math.round(t.production / t.people * 100) + "% of the team" : ""} />
          <Kpi label="In training" value={<span className={t.training ? "amber-ink" : ""}>{fmtInt(t.training)}</span>} sub="training and OJT" />
          <Kpi label="Floor time needed" value={fmtHM(t.floor_needed_min)} sub="8 h a working day, 4 h a half day" />
          {t.on_floor_min != null ? <Kpi label="On floor · idle · breaks" value={fmtHM(t.on_floor_min)}
              sub={<>{t.idle_min != null ? "idle " + fmtHM(t.idle_min) + " · " : ""}{t.break_min != null ? "breaks " + fmtHM(t.break_min) + (t.break_over_days ? " (" + plural(t.break_over_days, "day") + " over 1 h)" : "") + " · " : ""}{t.floor_judged ? t.floor_met + " of " + t.floor_judged + " met the floor time" : "from Purview Shastra"}</>} tone={t.floor_judged && t.floor_met < t.floor_judged ? "" : "good"} />
            : <Kpi label="On floor · idle · breaks" value={<span className="muted">–</span>} sub={d.floor_source === "ok" ? "no attendance in Purview Shastra for these dates" : FLOOR_SRC[d.floor_source] || "from Purview Shastra"} />}
          <Kpi label="Attainment" value={t.attain == null ? "–" : t.attain + "%"} sub={t.attain_basis === "done" ? fmtInt(t.worked_done) + " of " + fmtInt(Math.round(t.target_done)) + " claims up to yesterday" : fmtInt(t.worked_today) + " of " + fmtInt(Math.round(t.target_today)) + " claims today"} />
        </div>
        <div className="card">
          <div className="row between"><div className="cv-sec" style={{ margin: 0 }}>Team status by team lead</div><button className="btn sm" onClick={csv}>⬇ CSV for supervisors</button></div>
          <div className="table-wrap mt8"><table className="t ts">
            <thead><tr><th>Team lead / associate</th><th>DOJ</th><th>Status</th><th>Ramp-up / plan</th><th className="num">Attainment</th><th className="num" title="Floor time needed: 8 h a working day, 4 h a half day">Floor needed</th><th className="num">On floor</th><th className="num">Idle</th><th className="num" title="Breaks taken, from Purview Shastra. Shastra allows 60 minutes a day">Breaks</th><th>Performance</th><th>Comment</th></tr></thead>
            <tbody>{groups.map((g) => { const open = !closed[g.key || "none"]; const gr = g.rows, wk = gr.reduce((a, r) => a + r.worked, 0), tg = gr.reduce((a, r) => a + r.target, 0);
              return <React.Fragment key={g.key || "none"}>
                <tr className="tlrow click" onClick={() => setClosed((c) => ({ ...c, [g.key || "none"]: open }))}><td><span className="caret">{open ? "▾" : "▸"}</span> <b>{g.name}</b></td>
                  <td colSpan={3} className="small muted">{plural(gr.length, "person", "people")} · {gr.filter((r) => r.status === "Production").length} production{gr.some((r) => r.status !== "Production") ? " · " + gr.filter((r) => r.status !== "Production").length + " other" : ""}</td>
                  <td className="num">{attainStamp((() => { const wd = gr.reduce((a, r) => a + r.worked_done, 0), td = gr.reduce((a, r) => a + r.target_done, 0), wt = gr.reduce((a, r) => a + r.worked_today, 0), tt = gr.reduce((a, r) => a + r.target_today, 0); return td > 0 ? Math.round(wd / td * 100) : tt ? Math.round(wt / tt * 100) : null; })())}</td><td className="num">{fmtHM(gr.reduce((a, r) => a + r.floor_needed_min, 0))}</td>
                  <td className="num">{gr.some((r) => r.on_floor_min != null) ? <>{fmtHM(gr.reduce((a, r) => a + (r.on_floor_min || 0), 0))}{gr.some((r) => r.floor === "short") ? <div className="tiny amber-ink">{gr.filter((r) => r.floor === "short").length} short</div> : null}</> : <span className="muted">–</span>}</td>
                  <td className="num">{gr.some((r) => r.idle_min != null) ? fmtHM(gr.reduce((a, r) => a + (r.idle_min || 0), 0)) : <span className="muted">–</span>}</td>
                  <td className="num">{gr.some((r) => r.break_min != null) ? <>{fmtHM(gr.reduce((a, r) => a + (r.break_min || 0), 0))}{gr.reduce((a, r) => a + (r.break_over_days || 0), 0) ? <div className="tiny amber-ink">{gr.reduce((a, r) => a + (r.break_over_days || 0), 0)} days over 1 h</div> : null}</> : <span className="muted">–</span>}</td>
                  <td>{gr.some((r) => r.perf === "below") ? <span className="badge amber">{plural(gr.filter((r) => r.perf === "below").length, "outlier")}</span> : <span className="badge green">Clear</span>}</td><td /></tr>
                {open && gr.map((r) => <tr key={r.id}>
                  <td><span className="child">•</span><button type="button" className="btn link biller-link" style={{ padding: 0 }} onClick={() => go("claims", { assigned_to: r.id, state: "" })}>{r.name}</button>
                    <div><button type="button" className="btn link tiny" style={{ padding: 0 }} title={"What was allocated to " + r.name + " and what they worked, " + word} onClick={() => setAlloc(r)}>allocations</button></div></td>
                  <td className="small nowrap">{r.doj ? fmtDate(r.doj) : <span className="muted">–</span>}</td>
                  <td><span className={"badge " + (TS_STATUS_TONE[r.status] || "gray")}>{r.status}</span></td>
                  <td>{rampCell(r)}</td>
                  <td className="num">{attainStamp(r.attain)}<div className="tiny muted">{r.attain_basis === "done" ? r.worked_done + " of " + Math.round(r.target_done) + " to yesterday" : r.worked_today + " of " + Math.round(r.target_today) + " today"}{r.attain_basis === "done" && r.worked_today ? " · " + r.worked_today + " today" : ""}</div></td>
                  <td className="num">{fmtHM(r.floor_needed_min)}{r.days_half || r.days_out ? <div className="tiny muted">{[r.days_half ? plural(r.days_half, "half day") : "", r.days_out ? r.days_out + " out" : ""].filter(Boolean).join(" · ")}</div> : null}</td>
                  <td className="num">{floorCell(r, d.floor_source)}</td><td className="num">{idleCell(r)}</td><td className="num">{breakCell(r)}</td>
                  <td>{perfCell(r, d.perf_mark)}{r.out_today ? <div className="tiny muted">{r.out_today === "half" ? "half day today" : "out today"}</div> : null}</td>
                  <td><button type="button" className="btn sm note-btn" title={r.comment || "Add a start, end or comment"} onClick={() => setEdit({ r, start: r.start_date, end: r.end_date, comment: r.comment })}>{r.comment ? <span className="clamp3">{r.comment}</span> : <span className="muted">+ Add note</span>}</button></td>
                </tr>)}
              </React.Fragment>; })}</tbody></table></div>
          <div className="tiny muted mt8"><b>Floor time needed:</b> 8 h for each working day in the dates, 4 h for a half day (Out today · Half day), none on leave. <b>On floor</b> comes from Purview Shastra (finished shifts, breaks taken out; a shift still open counts up to now) and is met or short on the finished days; Shastra's attendance also decides half days, leave and week offs. <b>Idle</b> is what Shastra Guard saw while they were punched in, breaks left out: no movement plus screen locked. <b>Ramp-up:</b> Training and OJT are due in production {d.ramp_weeks} weeks from their start (the start date kept here, otherwise the date of joining). <b>Attainment</b> counts the days already finished (up to yesterday), so a day still under way does not count against anyone; with only today picked, it is today's. <b>Performance:</b> attainment under {d.perf_mark}% is below the production mark. Status and date of joining come from Purview Shastra.</div>
        </div>
        <div className="card">
          <div className="row between"><div className="cv-sec" style={{ margin: 0 }}>Suggestions · {word}</div><button className="btn sm" onClick={copy}>⬇ Copy for my 1:1s</button></div>
          <div className="sg-grid mt8"><Sugg tone="red" title="Do today" list={sg.today} /><Sugg tone="amber" title="This week" list={sg.week} /><Sugg tone="green" title="Keep going" list={sg.good} /></div>
          <div className="tiny muted mt8">Built from the same figures as the table, urgent first. Each pointer says what we see and what to do. Time on the floor and idle time come from Purview Shastra.</div>
        </div>
        <div className="grid ts-foot">
          <div className="card"><div className="cv-sec">Performance by status · {word}{t.attain_basis === "done" ? " · counted up to yesterday" : ""}</div>
            <div className="table-wrap"><table className="t"><thead><tr><th>Status</th><th className="num">People</th><th className="num">Claims</th><th className="num">Target</th><th className="num">Attainment</th><th className="num">Claims a day</th></tr></thead>
              <tbody>{d.by_status.map((x) => <tr key={x.status}><td className="b">{x.status}</td><td className="num">{x.people}</td><td className="num">{fmtInt(x.worked)}</td><td className="num">{fmtInt(x.target)}</td><td className="num">{attainStamp(x.attain)}</td><td className="num">{x.per_day == null ? "–" : x.per_day}</td></tr>)}</tbody></table></div></div>
          <div className="card"><div className="cv-sec">Roster checks</div>
            <div className="stack" style={{ gap: 8 }}>{d.checks.map((c, i) => <div key={i} className="row" style={{ gap: 8, flexWrap: "nowrap", alignItems: "flex-start" }}><span className={"badge " + (c.n ? "amber" : "green")}>{c.n}</span><span className="small">{c.text}</span></div>)}
              <div className="tiny muted">Fix these in Purview Shastra; Brahmastra picks them up on the next roster sync.</div></div></div>
        </div>
      </>}
      {edit && <Modal title={edit.r.name} sub="Start, end and comment on Team status: every lead who sees this person sees them." narrow onClose={() => setEdit(null)}
        footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
        <div className="stack">
          <div className="grid g2"><Field label="Start (training, OJT or a plan)" hint="Empty: the date of joining"><input className="input" type="date" value={edit.start || ""} onChange={(e) => setEdit({ ...edit, start: e.target.value })} /></Field>
            <Field label="Due in production (or plan end)" hint={"Empty: " + d.ramp_weeks + " weeks from the start"}><input className="input" type="date" value={edit.end || ""} onChange={(e) => setEdit({ ...edit, end: e.target.value })} /></Field></div>
          <Field label="Comment"><textarea className="textarea" style={{ minHeight: 70 }} value={edit.comment || ""} onChange={(e) => setEdit({ ...edit, comment: e.target.value })} placeholder="What was agreed, what to check next" /></Field>
          {edit.r.comment_by && <div className="tiny muted">Last saved by {edit.r.comment_by}{edit.r.comment_at ? " · " + fmtWhen(edit.r.comment_at) : ""}</div>}
        </div></Modal>}
    </div>
  );
}
/* What is waiting on this person: escalations, client requests to send, missed tasks. */
function NeedsStrip({ go }) {
  const q = useRpc("notify.list", {}, []);
  const items = ((q.data && q.data.items) || []).filter((i) => ["escalations", "client_requests", "missed"].includes(i.key) && i.n > 0);
  if (!items.length) return null;
  const red = items.some((i) => i.tone === "red");
  return (
    <div className="card tight row needs-strip" style={{ gap: 14, flexWrap: "wrap", borderLeft: "4px solid " + (red ? "var(--red)" : "#E8A13C"), background: red ? "var(--red-soft)" : "var(--amber-soft)" }}>
      <b style={{ color: red ? "var(--red-ink)" : "var(--amber-ink)" }}>Needs you:</b>
      {items.map((i) => <button key={i.key} type="button" className="btn sm link" style={{ padding: 0 }} onClick={() => go(i.view, i.params)}>{i.text}</button>)}
    </div>
  );
}
/* The claims part: the inventory as of now (click a bar to narrow the page to it) and the activity for the dates. */
function ClaimsSection({ ctx, go, clientId, setClientId, locId, setLocId, leadId, leadName, rangeMs, rangeLabel, middle, compact }) {
  /* Cross-filters, Power BI style: a clicked slice narrows every figure on the page. */
  const [fl, setFl] = useState({});
  const toggleFl = (k, v) => setFl((f) => (f[k] === v ? Object.fromEntries(Object.entries(f).filter(([x]) => x !== k)) : { ...f, [k]: v }));
  const flCount = Object.keys(fl).length;
  const FL_LABEL = { tier: "Tier", bucket: "Age", status_class: "File status", payer: "Payer", saag_status: "SAAG status", saag_bucket: "Bucket after work", inventory_kind: "Inventory", assigned_to: "Team member" };
  const flText = (k, v) => k === "status_class" ? (STATUS_LABEL[v] || v) : k === "assigned_to" ? ((ctx.users.find((u) => u.id === v) || {}).name || v) : v;
  const base = { client_id: clientId || undefined, location_id: locId || undefined, lead_id: leadId || undefined };
  const stats = useRpc("claims.stats", { ...base, ...fl }, [clientId, locId, leadId, JSON.stringify(fl)]);
  const act = useRpc("team.activity", { ...base, ...(rangeMs || {}) }, [clientId, locId, leadId, JSON.stringify(rangeMs)]);
  const d = stats.data, a = act.data;
  const st = (k) => (d && d.states.find((s) => s.state === k)) || { n: 0, amt: 0 };
  const open = st("open"), assigned = st("assigned"), prog = st("in_progress"), done = st("completed"), excl = st("excluded"), proc = st("in_process");
  const workable = open.n + assigned.n + prog.n + done.n;
  const workableAmt = open.amt + assigned.amt + prog.amt + done.amt;
  const openClaims = (extra) => go("claims", { clientId, locationId: locId, ...fl, ...extra });
  const [overdueOpen, setOverdueOpen] = useState(false);
  const locName = (id) => { for (const c of ctx.clients) { const l = c.locations.find((x) => x.id === id); if (l) return l.name; } return ""; };
  const word = rangeLabel.toLowerCase();
  return (
    <>
    <div className={compact ? "dash-claims" : "card dash-claims"} style={compact ? { padding: "6px 2px 0" } : undefined}>
      <div className="row between"><div className="cv-sec" style={{ margin: 0 }}>{compact ? "Claims in detail" : "Claims"}</div><span className="small muted">{compact ? "the inventory as of now · click a bar to narrow these charts" : "the inventory as of now · worked, closed and loaded for " + word}</span></div>
      {overdueOpen && <OverdueModal ctx={ctx} clientId={clientId} locId={locId} onClose={() => setOverdueOpen(false)} onChanged={() => stats.reload()} />}
      {d && d.overdue && d.overdue.n > 0 && (
        <div className="row between mt8" style={{ borderLeft: "4px solid var(--red)", background: "var(--red-soft)", borderRadius: 8, padding: "8px 12px" }}>
          <div className="small"><b style={{ color: "var(--red-ink)" }}>{fmtInt(d.overdue.n)} claims are past their follow-up date with no new entry</b> · {fmtMoney(d.overdue.amt)}. They sit with nobody until a biller gets them again.</div>
          <div className="row"><button className="btn sm" onClick={() => openClaims({ overdue: true })}>See them</button><button className="btn sm primary" onClick={() => setOverdueOpen(true)}>Assign to a biller</button></div>
        </div>
      )}
      {(flCount > 0 || clientId || leadId) && (
        <div className="row between mt8" style={{ background: "var(--soft)", borderRadius: 8, padding: "8px 12px" }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><span className="small b">Showing:</span>
            {clientId && <span className="chip on">{(ctx.clients.find((c) => c.id === clientId) || {}).name}{locId ? " · " + locName(locId) : ""}</span>}
            {leadId && <span className="chip on">{leadName || "Team lead"}'s clients</span>}
            {Object.entries(fl).map(([k, v]) => <button key={k} className="chip on" title="Click to remove this filter" onClick={() => toggleFl(k, v)}>{FL_LABEL[k] || k}: {flText(k, v)} ✕</button>)}
          </div>
          <div className="row"><button className="btn sm" onClick={() => openClaims({ state: fl.saag_status || fl.saag_bucket ? "" : "workable" })}>Open these claims</button>{flCount > 0 && <button className="btn sm link" onClick={() => setFl({})}>Clear filters</button>}</div>
        </div>
      )}
      <ErrorBox error={stats.error || act.error} />
      {!d && !stats.error && <div className="mt8"><Spinner label="Loading…" /></div>}
      {d && !compact && (
        <div className="stack mt8">
          <div className="grid dash-k6">
            <Kpi label="Workable AR" value={fmtMoney(workableAmt)} sub={plural(workable, "claim") + " open, on desks or worked"} tone="accent" onClick={() => openClaims({ state: "workable" })} />
            <Kpi label="Unassigned" value={fmtInt(open.n)} sub={fmtMoney(open.amt) + " waiting for allocation"} onClick={() => openClaims({ state: "open" })} />
            <Kpi label="On desks" value={fmtInt(assigned.n + prog.n)} sub={fmtMoney(assigned.amt + prog.amt) + " · " + fmtInt(prog.n) + " open now"} />
            <Kpi label="In process" value={fmtInt(proc.n)} sub={fmtMoney(proc.amt) + " with Posting / Submission"} tone={proc.n ? "accent" : ""} onClick={() => openClaims({ state: "in_process" })} />
            <Kpi label={"Closed · " + word} value={<span className="teal-ink">{a ? fmtInt(a.closed_n) : "…"}</span>} sub={a ? fmtMoney(a.closed_amt) : ""} tone="good" />
            <Kpi label="Follow-ups due" value={<span className={d.follow_ups_due && d.follow_ups_due.n ? "amber-ink" : ""}>{fmtInt(d.follow_ups_due ? d.follow_ups_due.n : 0)}</span>} sub={fmtInt(d.overdue ? d.overdue.n : 0) + " overdue · " + fmtInt(done.n) + " worked, awaiting"} onClick={() => openClaims({ follow_up_due: true })} />
          </div>
          <div className="row small muted dash-strip" style={{ gap: 18, flexWrap: "wrap" }}>
            <span><b className="ink">{a ? fmtInt(a.worked) : "…"}</b> entries on <b className="ink">{a ? fmtInt(a.claims_worked) : "…"}</b> claims · {word}</span>
            <span><b className="ink">{a ? fmtInt(a.loaded_n) : "…"}</b> claims loaded{a && a.loaded_n ? " (" + fmtMoney(a.loaded_amt) + ")" : ""}</span>
            <span><b className="ink">{a ? fmtInt(a.assigned_n) : "…"}</b> allocated</span>
            <button type="button" className="btn sm link" style={{ padding: 0 }} onClick={() => go("attention")}><b className={d.escalated ? "red-ink" : "ink"}>{fmtInt(d.escalated)}</b> escalated</button>
            <span><b className="ink">{fmtInt(excl.n)}</b> excluded</span>
            <span><b className="ink">{fmtInt(sum(d.kinds.filter((k) => k.worked_before), (k) => k.n))}</b> worked before · {fmtInt(sum(d.kinds.filter((k) => !k.worked_before), (k) => k.n))} fresh</span>
          </div>
        </div>
      )}
    </div>
    {middle}
    {d && (
        <div className="stack dash-details">
          {!compact && <div className="cv-sec" style={{ margin: "6px 0 0" }}>Claims in detail · click a bar to narrow the whole page</div>}
          <CallTimeCard clientId={clientId} locId={locId} rangeMs={rangeMs} rangeLabel={rangeLabel} />
          <div className="card"><h3>By client and location</h3><div className="sub mb">Where the inventory stands at each location. Click a row to focus the dashboard on it.</div>
            <div className="table-wrap"><table className="t"><thead><tr><th>Client</th><th>Location</th><th className="r">Unassigned</th><th className="r">On desks</th><th className="r">Worked, awaiting follow-up</th><th className="r">In process</th><th className="r">Overdue</th><th className="r">Closed</th><th className="r">Workable $</th></tr></thead>
              <tbody>{(d.by_location || []).map((r, i) => { const on = clientId === r.client_id && (locId || "") === (r.location_id || ""); return (
                <tr key={i} className="click" style={on ? { background: "var(--soft)" } : undefined} title={`${r.client_name}${r.location_name ? " · " + r.location_name : ""}\n${fmtInt(r.n)} claims on file · ${fmtMoney(r.amt)} workable\nClick to focus the dashboard here; click again to go back.`} onClick={() => { if (on) { setClientId(""); setLocId(""); } else { setClientId(r.client_id); setLocId(r.location_id || ""); } }}>
                  <td><b>{r.client_name}</b></td><td>{r.location_name || <span className="muted">(no location)</span>}</td>
                  <td className="num" title={fmtMoney(r.open_amt)}>{fmtInt(r.open_n)}</td><td className="num" title={fmtMoney(r.desk_amt)}>{fmtInt(r.desk_n)}</td><td className="num" title={fmtMoney(r.worked_amt)}>{fmtInt(r.worked_n)}</td><td className="num" title={fmtMoney(r.process_amt)}>{fmtInt(r.process_n || 0)}</td>
                  <td className="num" style={r.overdue_n ? { color: "var(--red-ink)", fontWeight: 700 } : undefined}>{fmtInt(r.overdue_n)}</td><td className="num" title={fmtMoney(r.closed_amt)}>{fmtInt(r.closed_n)}</td><td className="num">{fmtMoney(r.amt)}</td>
                </tr>); })}
                {!(d.by_location || []).length && <tr><td colSpan={9} className="muted">No claims yet.</td></tr>}</tbody></table></div></div>
          <div className="grid g3">
            <div className="card"><h3>By value tier</h3><div className="sub mb">Low under $100 · Medium up to the average · High above it</div>
              <Bars rows={["High", "Medium", "Low"].map((t) => d.tiers.find((x) => x.tier === t) || { tier: t, n: 0, amt: 0 })} labelOf={(r) => r.tier} valueOf={(r) => r.amt} countOf={(r) => r.n} subOf={(r) => plural(r.n, "claim")} onClick={(r) => toggleFl("tier", r.tier)} isOn={(r) => fl.tier === r.tier} /></div>
            <div className="card"><h3>By age</h3><div className="sub mb">Days since date of service as of the day the file was uploaded, not today</div>
              <Bars rows={BUCKET_ORDER.map((b) => d.buckets.find((x) => x.bucket === b) || { bucket: b, n: 0, amt: 0 })} labelOf={(r) => r.bucket} valueOf={(r) => r.amt} countOf={(r) => r.n} subOf={(r) => plural(r.n, "claim")} onClick={(r) => toggleFl("bucket", r.bucket)} isOn={(r) => fl.bucket === r.bucket} /></div>
            <div className="card"><h3>By status in file</h3><div className="sub mb">Rejected and denied are worked first</div>
              <Bars rows={[...d.classes].sort((a, b) => STATUS_ORDER.indexOf(a.status_class) - STATUS_ORDER.indexOf(b.status_class))} labelOf={(r) => STATUS_LABEL[r.status_class] || r.status_class} valueOf={(r) => r.amt} countOf={(r) => r.n} subOf={(r) => plural(r.n, "claim")} onClick={(r) => toggleFl("status_class", r.status_class)} isOn={(r) => fl.status_class === r.status_class} /></div>
          </div>
          <div className="grid g3">
            <div className="card"><h3>Buckets after work</h3><div className="sub mb">Where the ball is, from the last SAAG entry on each claim</div>
              <Bars rows={BUCKETS4.map((b) => (d.work_buckets || []).find((x) => x.bucket === b) || { bucket: b, n: 0, amt: 0 })} labelOf={(r) => r.bucket} valueOf={(r) => r.amt} countOf={(r) => r.n} subOf={(r) => plural(r.n, "claim")} onClick={(r) => toggleFl("saag_bucket", r.bucket)} isOn={(r) => fl.saag_bucket === r.bucket} /></div>
            <div className="card"><h3>SAAG statuses</h3><div className="sub mb">Last status the team entered</div>
              <Bars rows={d.saag_statuses || []} labelOf={(r) => r.status} valueOf={(r) => r.amt} countOf={(r) => r.n} subOf={(r) => plural(r.n, "claim")} onClick={(r) => toggleFl("saag_status", r.status)} isOn={(r) => fl.saag_status === r.status} /></div>
          <div className="card"><h3>Payer concentration</h3><div className="sub mb">Fewest payers holding the most balance: fewest calls for the most money</div>
              <Bars rows={d.payers} labelOf={(r) => r.payer || "Unknown"} valueOf={(r) => r.amt} countOf={(r) => r.n} subOf={(r) => plural(r.n, "claim")} onClick={(r) => { if (r.payer) toggleFl("payer", r.payer); }} isOn={(r) => !!r.payer && fl.payer === r.payer} /></div>
          </div>
        </div>
      )}
    </>
  );
}
/* ---------- clients & locations ---------- */
/* Clients & locations: the clients and their locations, and which billers work each one (with today's team). */
/* ---------- Client profile setup: scope of work, locations, targets, production file, responsible people ---------- */
/* Each scope's production folder in the client's OneDrive (Brahmastra Clients / <Client> / Production / ...). */
const PROD_SCOPES = [["ar", "AR"], ["posting", "Payment posting"], ["submission", "Submission"], ["rejection", "Rejections"]];
const PROD_FOLDER = { ar: "AR", posting: "Payment posting", submission: "Submission", rejection: "Rejections" };
const SERVICES_UI = [["ar", "AR follow-up", "Calling payers and working denials: the team lead accountable"], ["posting", "Payment posting", "Posting payments from EOBs / ERAs"],
  ["submission", "Submission", "Submitting and resubmitting claims"], ["rejection", "Rejections", "Fixing rejected claims, first priority"]];
const SERVICE_UI_NAME = Object.fromEntries(SERVICES_UI.map(([k, l]) => [k, l]));
const profileFrom = (c) => {
  const pick = (m, l, b) => (c && c[m] === "person" ? { lead: c[l] || "", backup: (b && c[b]) || "" } : { lead: "", backup: "" });
  return { scope: (c && c.scope_of_work) || [], targets: (c && c.targets) || {}, tat: { posting: (c && c.posting_tat_hours) || 24, submission: (c && c.submission_tat_hours) || 24 },
    resp: { ar: pick("ar_mode", "ar_lead", "ar_backup"), posting: pick("posting_mode", "posting_lead", "posting_backup"), submission: pick("submission_mode", "submission_lead", "submission_backup"),
      rejection: pick("rejection_mode", "rejection_lead", "rejection_backup"), subcheck: { mode: (c && c.submission_check_mode) || "", lead: (c && c.submission_check_person) || "" } } };
};
function profileMissing(f, locCount) {
  const m = [];
  if (!f.name.trim()) m.push("client name");
  if (!f.scope.length) m.push("scope of work");
  if (!locCount) m.push("a location");
  for (const s of f.scope) {
    if (s === "ar" && !(Number(f.targets[s]) > 0)) m.push(SERVICE_UI_NAME[s] + " target");
    if (!f.resp[s].lead) m.push(SERVICE_UI_NAME[s] + " responsible person");
  }
  for (const k of tatScopes(f.scope)) { const v = Number(f.tat[k]); if (!(v >= 1 && v <= 240)) m.push(SERVICE_UI_NAME[k] + " TAT"); }
  if (f.scope.includes("submission") && !(f.resp.subcheck.mode === "biller" || (f.resp.subcheck.mode === "person" && f.resp.subcheck.lead))) m.push("who rechecks submissions after 48 hours");
  return m;
}
// Payment posting and Submission have a TAT (Rejections resubmit to the Submission TAT); only AR has a daily target.
const tatScopes = (scope) => ["posting", "submission"].filter((k) => scope.includes(k) || (k === "submission" && scope.includes("rejection")));
const Step = ({ n, title, sub, children }) => <div className="group"><div className="gt row" style={{ gap: 8 }}><span className="stepn">{n}</span>{title}</div>{sub && <div className="tiny muted" style={{ margin: "-4px 0 8px" }}>{sub}</div>}{children}</div>;
function ClientProfileForm({ ctx, client, onClose, onSaved }) {
  const isNew = !client;
  const [f, setF] = useState(() => ({ name: client ? client.name : "", code: client ? client.code || "" : "", follow_up_days: client ? client.follow_up_days : 30, active: client ? client.active : true,
    workbook_link: client ? client.workbook_link || "" : "", prodMode: client && client.workbook_link ? "link" : "auto", locations: [], locDraft: "", ...profileFrom(client) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const setResp = (k, patch) => setF((x) => ({ ...x, resp: { ...x.resp, [k]: { ...x.resp[k], ...patch } } }));
  const toggle = (k) => setF((x) => ({ ...x, scope: x.scope.includes(k) ? x.scope.filter((y) => y !== k) : SERVICES_UI.map(([s]) => s).filter((s) => s === k || x.scope.includes(s)) }));
  const people = ctx.users.filter((u) => u.active).sort((a, b) => a.name.localeCompare(b.name));
  const deptRe = { ar: /^(ar|accounts)/i, posting: /posting/i, submission: /submission/i, rejection: /submission|rejection/i };
  const opts = (k) => people.slice().sort((a, b) => ((deptRe[k] && deptRe[k].test(b.department || "")) - (deptRe[k] && deptRe[k].test(a.department || ""))) || ((b.role === "supervisor") - (a.role === "supervisor")) || a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, label: u.name, sub: [u.designation || (u.role === "supervisor" ? "Supervisor" : "Biller"), u.department].filter(Boolean).join(" · ") }));
  const locCount = isNew ? f.locations.length : (client.locations || []).filter((l) => l.active).length;
  const missing = profileMissing(f, locCount);
  const addLoc = () => { const n = f.locDraft.trim(); if (n && !f.locations.some((l) => l.toLowerCase() === n.toLowerCase())) set({ locations: [...f.locations, n], locDraft: "" }); };
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await rpc("clients.save", { id: client ? client.id : undefined, name: f.name.trim(), code: f.code, follow_up_days: f.follow_up_days, active: f.active,
        locations: isNew ? f.locations : undefined, profile: { scope: f.scope, targets: f.targets, tat: f.tat, resp: f.resp } });
      toast(isNew ? f.name.trim() + " created. Everyone set as responsible sees it now." : "Client profile saved.");
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={isNew ? "New client" : "Client profile · " + client.name} sub="Every part is needed: without a scope, a location, a target and the people responsible, nothing reaches anyone." wide onClose={onClose}
      footer={<>{missing.length > 0 && <span className="tiny amber-ink" style={{ marginRight: "auto", maxWidth: 520 }}>Still needed: {missing.join(", ")}.</span>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || missing.length > 0} onClick={save}>{busy ? "Saving…" : isNew ? "Create client" : "Save profile"}</button></>}>
      <div className="stack">
        {err && <div className="alert err">{err}</div>}
        <Step n="1" title="Client">
          <div className="grid g3">
            <Field label="Client name"><input className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus={isNew} placeholder="e.g. Dr. Montella Eye Care" /></Field>
            <Field label="Short code" hint="Shown on badges and reports"><input className="input" value={f.code} maxLength={12} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
            <Field label="Default follow-up (days)"><input className="input" type="number" min={1} max={365} value={f.follow_up_days} onChange={(e) => set({ follow_up_days: e.target.value })} /></Field>
          </div>
          {!isNew && <label className="check mt8"><input type="checkbox" checked={!!f.active} onChange={(e) => set({ active: e.target.checked })} /> Active (inactive clients are hidden from uploads and allocation)</label>}
        </Step>
        <Step n="2" title="Scope of work" sub="What Purview does for this client. Anything not ticked is done by the client.">
          <div className="scope-grid">{SERVICES_UI.map(([k, l, d]) => <label key={k} className={"scope-opt" + (f.scope.includes(k) ? " on" : "")}><input type="checkbox" checked={f.scope.includes(k)} onChange={() => toggle(k)} /><span><b>{l}</b><span className="tiny muted">{d}</span></span></label>)}</div>
        </Step>
        <Step n="3" title="Locations" sub={isNew ? "At least one. Inventory is uploaded, allocated and reported per location." : "Add, rename or switch off locations on the client card."}>
          {isNew ? <><div className="row" style={{ gap: 6 }}><input className="input" style={{ maxWidth: 320 }} value={f.locDraft} placeholder="Location name, then Add" onChange={(e) => set({ locDraft: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLoc(); } }} /><button className="btn" onClick={addLoc} disabled={!f.locDraft.trim()}>Add</button></div>
            <div className="pill-list mt8">{f.locations.map((l) => <span key={l} className="chip on">{l} <button type="button" className="btn link sm" style={{ padding: 0 }} onClick={() => set({ locations: f.locations.filter((x) => x !== l) })}>×</button></span>)}{!f.locations.length && <span className="tiny muted">None yet.</span>}</div></>
            : <div className="pill-list">{(client.locations || []).filter((l) => l.active).map((l) => <span key={l.id} className="chip on">{l.name}</span>)}{!locCount && <span className="tiny red-ink">No active location: add one on the client card first.</span>}</div>}
        </Step>
        <Step n="4" title="Target and TAT" sub="AR has a daily target. Payment posting and Submission work to a TAT instead: the working hours they have to finish each claim sent to them (Saturday and Sunday not counted).">
          {f.scope.length ? <div className="grid g4">
            {f.scope.includes("ar") && <Field label="AR follow-up target" hint="Claims a day, whole team"><input className="input" type="number" min={1} max={5000} value={f.targets.ar || ""} onChange={(e) => set({ targets: { ...f.targets, ar: e.target.value } })} placeholder="claims a day" /></Field>}
            {tatScopes(f.scope).map((k) => <Field key={k} label={SERVICE_UI_NAME[k] + " TAT"} hint={k === "submission" && !f.scope.includes("submission") ? "Working hours · Rejections use it" : "Working hours"}><input className="input" type="number" min={1} max={240} value={f.tat[k] || ""} onChange={(e) => set({ tat: { ...f.tat, [k]: e.target.value } })} placeholder="24" /></Field>)}
          </div> : <div className="tiny muted">Pick the scope of work first.</div>}
        </Step>
        <Step n="5" title="OneDrive folders" sub="Made by Brahmastra, nothing to link.">
          <div className="small">In the Purviewautomate OneDrive, <b>Brahmastra Clients › {f.name.trim() || "client"}</b> with <b>Inventory</b> (drop the client's inventory files here; Upload inventory opens it) and <b>Production</b> with a folder per scope (AR, Payment posting, Submission, Rejections), each with a new file every month (e.g. <span className="mono">AR Production - {f.name.trim() || "client"} - Nov 2026.xlsx</span>), one row per entry or desk action. Everyone at Purview can open them with the link on the client card.</div>
          {client && client.od && client.od.link ? <a className="btn sm mt8" href={client.od.link} target="_blank" rel="noopener">Open the folder</a> : null}
        </Step>
        <Step n="6" title="Responsible people" sub="For each part of the scope. They get this client's claims and profile in their login straight away; a backup covers when they are out.">
          {f.scope.length ? f.scope.map((k) => (
            <div key={k} className="row mt8" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <b style={{ width: 150 }}>{SERVICE_UI_NAME[k]}</b>
              <Combo width={260} value={f.resp[k].lead} onChange={(v) => setResp(k, { lead: v })} placeholder="Responsible person…" options={opts(k)} />
              <Combo width={240} value={f.resp[k].backup} onChange={(v) => setResp(k, { backup: v })} placeholder="Backup (optional)…" options={opts(k).filter((o) => o.id !== f.resp[k].lead)} />
            </div>)) : <div className="tiny muted">Pick the scope of work first.</div>}
          {f.scope.includes("submission") && <div className="row mt8" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <b style={{ width: 150 }}>Submission follow-up</b>
            <Combo width={260} clearable={false} value={f.resp.subcheck.mode} onChange={(v) => setResp("subcheck", { mode: v })} placeholder="Who rechecks after 48 hours…" options={[{ id: "person", label: "A person" }, { id: "biller", label: "The biller who sent it" }]} />
            {f.resp.subcheck.mode === "person" && <Combo width={240} value={f.resp.subcheck.lead} onChange={(v) => setResp("subcheck", { lead: v })} placeholder="Person…" options={opts("submission")} />}
          </div>}
        </Step>
      </div>
    </Modal>
  );
}
const CLIENT_ACTION = { "client.save": "Profile", "client.responsibility": "Responsibility", "client.team": "Team", "client.location": "Location", "access.share": "Shared", "access.remove": "Share removed",
  "raci.save": "RACI", "client.log": "Call log", "digest.sendNow": "Digest" };
function ClientHistory({ c, onClose }) {
  const q = useRpc("clients.history", { client_id: c.id }, [c.id]);
  const rows = (q.data && q.data.rows) || [];
  return (
    <Modal title={"Change history · " + c.name} sub="Who changed what on this client: the profile, responsible people, teams, locations, shares, RACI and month-end. Supervisors on the client see it." wide onClose={onClose}>
      {q.error ? <div className="alert err">{q.error}</div> : !q.data ? <Spinner label="Loading…" /> : !rows.length ? <Empty>No changes recorded yet.</Empty> :
        <div className="stack" style={{ gap: 0 }}>{rows.map((r, i) => <div key={i} className="hist-row"><div className="tiny muted" style={{ width: 130, flex: "none" }}>{fmtWhen(r.at)}</div>
          <div style={{ flex: 1 }}><b>{r.user_name || "Brahmastra"}</b> <span className="badge gray">{CLIENT_ACTION[r.action] || (r.action.startsWith("monthend") ? "Month-end" : r.action)}</span><div className="small" style={{ whiteSpace: "pre-wrap" }}>{String(r.detail || "").split("; ").join("\n")}</div></div></div>)}</div>}
    </Modal>
  );
}
/* Claims of the clients a biller is responsible for (posting, submission...), to look at; work happens in their desk. */
function DeskClaimsView({ ctx, me }) {
  const mine = ctx.clients.filter((c) => c.responsible_me);
  const [cid, setCid] = useState((mine[0] || {}).id || "");
  const [qs, setQs] = useState("");
  const [state, setState] = useState("workable");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const q = useRpc("claims.list", { client_id: cid || undefined, q: qs.trim() || undefined, state, page, page_size: 50 }, [cid, qs, state, page], !!cid);
  const rows = (q.data && q.data.rows) || [];
  return (
    <div className="stack">
      <div><h1>Claims</h1><div className="sub">Every claim of the clients you are responsible for, to look up. Your work happens in {deskOf(me, null) ? "your desk tab" : "My day"}.</div></div>
      {!mine.length ? <div className="card"><Empty>You are not responsible for a client yet.</Empty></div> : <>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <span style={{ minWidth: 240 }}><Combo clearable={false} value={cid} onChange={(v) => { setCid(v); setPage(1); }} options={mine.map((c) => ({ id: c.id, label: c.name }))} /></span>
          <input className="input" style={{ maxWidth: 280 }} placeholder="claim #, patient, account, payer" value={qs} onChange={(e) => { setQs(e.target.value); setPage(1); }} />
          <div className="seg2">{[["workable", "Open"], ["", "All"]].map(([k, l]) => <button key={k} className={state === k ? "on" : ""} onClick={() => { setState(k); setPage(1); }}>{l}</button>)}</div>
        </div>
        <div className="card tight"><div className="table-wrap"><table className="t">
          <thead><tr><th>Claim #</th><th>Patient</th><th>DOS</th><th>Payer</th><th className="num">Balance</th><th>State</th><th>With</th></tr></thead>
          <tbody>{rows.map((c) => <tr key={c.id} className="click" onClick={() => setOpen(c.id)}><td className="mono">{c.claim_no}</td><td className="phi">{c.patient}</td><td>{fmtDate(c.dos)}</td><td>{c.payer}</td><td className="num">{fmtMoney(c.balance, 2)}</td><td className="small">{c.state}</td><td className="small">{c.assigned_name || "–"}</td></tr>)}</tbody></table></div>
          {!q.data ? <Spinner label="Loading…" /> : !rows.length ? <Empty>No claims match.</Empty> : null}
          {q.data && q.data.total > rows.length && <div className="row between mt8"><span className="tiny muted">{fmtInt(q.data.total)} claims</span><span><button className="btn sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button> <button className="btn sm" disabled={page * 50 >= q.data.total} onClick={() => setPage(page + 1)}>Next</button></span></div>}
        </div></>}
      {open && <ClaimDrawer id={open} ctx={ctx} me={me} onClose={() => setOpen(null)} onChanged={() => q.reload()} />}
    </div>
  );
}
/* The people on a client, on its card: the AR billers who get its claims (and its claims and profile in their login).
   Posting, submission and rejections have their person and backup on the rows below. */
function ClientPeople({ c, ctx, ro, onSaved, focus, dir }) {
  const ref = useRef(null);
  const [adding, setAdding] = useState(!!focus);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (focus && ref.current) { ref.current.scrollIntoView({ behavior: "smooth", block: "center" }); ref.current.classList.add("flash"); } }, [focus]);
  const team = c.team || [];
  const nameOf = (id) => (ctx.users.find((u) => u.id === id) || (dir || []).find((u) => u.id === id) || {}).name || (c.team_names && c.team_names[id]) || "someone";
  const save = async (next, msg) => { setBusy(true); try { await rpc("clients.saveTeam", { client_id: c.id, team: next, auto_allocate: c.auto_allocate !== false }); toast(msg); setPick(""); onSaved && onSaved(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  // everyone active (not only this lead's own team), billers first
  const people = (dir && dir.length ? dir.map((d) => ({ ...d, active: true, role: d.role || (/biller/i.test(d.designation) ? "user" : "") })) : ctx.users.filter((u) => u.active));
  const opts = people.filter((u) => !team.includes(u.id)).sort((a, b) => ((b.role === "user") - (a.role === "user")) || a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, label: u.name, sub: [u.designation || (u.role === "user" ? "Biller" : "Supervisor"), u.department].filter(Boolean).join(" · ") }));
  return (
    <div ref={ref} className="small mt8 people-row">
      <b>AR billers on this client:</b> {team.length ? team.map((id) => <span key={id} className="badge teal" style={{ marginRight: 4 }}>{nameOf(id)}{!ro && <button type="button" className="btn link sm" style={{ padding: "0 0 0 4px" }} title="Take off this client" disabled={busy} onClick={() => save(team.filter((x) => x !== id), nameOf(id) + " taken off " + c.name + ".")}>×</button>}</span>) : <span className="muted">none yet (claims go to these people when they load and in Allocate)</span>}
      {!ro && !adding && <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => setAdding(true)}>+ Add people</button>}
      {!ro && adding && <span className="row" style={{ display: "inline-flex", gap: 6, marginLeft: 6, verticalAlign: "middle" }}>
        <span style={{ minWidth: 240 }}><Combo sm value={pick} onChange={setPick} placeholder="Pick a biller…" options={opts} /></span>
        <button className="btn sm primary" disabled={busy || !pick} onClick={() => save([...team, pick], nameOf(pick) + " added to " + c.name + ". They see it in their login now.")}>Add</button>
        <button className="btn sm link" onClick={() => { setAdding(false); setPick(""); }}>done</button></span>}
    </div>
  );
}
function ClientsHub({ ctx, reload, go, me, initialTab, params }) {
  const [tab, setTab] = useState(initialTab || "clients");
  return (
    <div className="stack">
      <div className="row between"><div><h1>Clients & locations</h1><div className="sub">{tab === "clients" ? "Inventory is uploaded per client and location; allocation and reports follow the same split." : "Which billers work each client and location, who works each project today, and allocation on upload."}</div></div>
        <div className="row" style={{ gap: 4 }}>{[["clients", "Clients & locations"], ["billers", "Billers & today's team"]].map(([k, l]) => <button key={k} className={"chip " + (tab === k ? "on" : "")} onClick={() => setTab(k)}>{l}</button>)}</div></div>
      {tab === "clients" ? <ClientsView ctx={ctx} reload={reload} embedded me={me} go={go} params={params} /> : <LocationsView ctx={ctx} reload={reload} go={(v) => (v === "clients" ? setTab("clients") : go(v))} embedded />}
    </div>
  );
}
function ClientsView({ ctx, reload, embedded, me, go, params }) {
  const ro = !me || me.role !== "supervisor";
  // Changes made by anyone show on opening: the client list is fetched again each time.
  useEffect(() => { if (reload) reload(); }, []);
  const [hist, setHist] = useState(null);
  const [prof, setProf] = useState(null);
  // Find a client: by name, code or location, and narrow by status. Opening a client from elsewhere clears the search so it shows.
  const [cq, setCq] = useState(""), [cf, setCf] = useState("all");
  useEffect(() => { if (params && params.client_id) { setCq(""); setCf("all"); } }, [params && params.client_id]);
  const cqn = cq.trim().toLowerCase();
  const shownClients = ctx.clients.filter((c) => (cf === "all" || (cf === "active" && c.active) || (cf === "inactive" && !c.active) || (cf === "setup" && (c.profile_gaps || []).length > 0) || (cf === "mine" && c.responsible_me))
    && (!cqn || [c.name, c.code, ...(c.locations || []).map((l) => l.name)].some((x) => String(x || "").toLowerCase().includes(cqn))));
  const dirQ = useRpc("users.directory", {}, [], !ro);
  const dir = (dirQ.data && dirQ.data.people) || [];
  const [edit, setEdit] = useState(null);
  const [locName, setLocName] = useState({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await rpc("clients.save", edit); toast("Client saved."); setEdit(null); reload(); } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const addLoc = async (c) => {
    const name = (locName[c.id] || "").trim(); if (!name) return;
    try { await rpc("locations.save", { client_id: c.id, name }); setLocName({ ...locName, [c.id]: "" }); toast("Location added."); reload(); } catch (e) { toast(e.message, "err"); }
  };
  const toggleLoc = async (l) => { try { await rpc("locations.save", { id: l.id, name: l.name, active: !l.active }); reload(); } catch (e) { toast(e.message, "err"); } };
  const makeFolders = async (c) => { setBusy(true); try { const r = await rpc("clients.setupFolders", c ? { client_id: c.id } : {}); toast(r.failed.length ? `Folders made for ${r.done}; not for ${r.failed.length}: ${r.failed[0].error}` : c ? "Folders made in OneDrive for " + c.name + "." : `Folders made in OneDrive for ${r.done} clients.`, r.failed.length ? "err" : "ok"); reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const wbStatus = (id) => (ctx.settings && ctx.settings["workbook_status:" + id]) || null;
  /* No workbook link: Brahmastra keeps the month's Production file in the Purviewautomate OneDrive by itself. */
  const [del, setDel] = useState(null);
  const [delTyped, setDelTyped] = useState("");
  const doDelete = async () => {
    setBusy(true);
    try { const r = await rpc("clients.delete", { id: del.id, confirm: delTyped.trim() }); toast(`${r.name} deleted with ${fmtInt(r.claims)} claims.`); setDel(null); setDelTyped(""); setEdit(null); reload(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  return (
    <div className="stack">
      {del && (
        <Modal title={"Delete " + del.name + "?"} sub="This removes the client, its locations, every upload and claim under it, and the notes on those claims. It cannot be undone. To keep the history but hide the client, untick Active instead." onClose={() => setDel(null)} narrow footer={<><button className="btn" onClick={() => setDel(null)} disabled={busy}>Cancel</button><button className="btn danger" onClick={doDelete} disabled={busy || delTyped.trim().toLowerCase() !== del.name.trim().toLowerCase()}>{busy ? "Deleting…" : "Delete client"}</button></>}>
          <Field label={"Type " + del.name + " to confirm"}><input className="input" value={delTyped} onChange={(e) => setDelTyped(e.target.value)} autoFocus /></Field>
        </Modal>
      )}
      <div className="row between"><div>{!embedded && <><h1>{ro ? "My clients" : "Clients & locations"}</h1><div className="sub">{ro ? "The clients you work on or are responsible for: scope of work, locations and who does what. Only supervisors change them." : "Inventory is uploaded per client and location; allocation and reports follow the same split."}</div></>}</div>
        {!ro && !isSmeUI(me) && <div className="row" style={{ gap: 6 }}><button className="btn" disabled={busy} onClick={() => makeFolders(null)} title="Make the OneDrive folders for every client that has none yet">Make OneDrive folders</button><button className="btn primary" onClick={() => setProf({ client: null })}>Add client</button></div>}</div>
      {!ctx.clients.length && <div className="card"><Empty>No clients yet. Add your first client, then its locations.</Empty></div>}
      {ctx.clients.length > 1 && <div className="row client-find" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" style={{ maxWidth: 320 }} type="search" placeholder="Search clients by name, code or location…" value={cq} onChange={(e) => setCq(e.target.value)} aria-label="Search clients" />
        <div className="seg2" role="radiogroup" aria-label="Filter clients">{[["all", "All"], ["active", "Active"], ["inactive", "Inactive"], ...(ro ? [] : [["setup", "Needs setup"]]), ["mine", "I'm responsible"]].map(([k, l]) =>
          <button key={k} type="button" className={cf === k ? "on" : ""} onClick={() => setCf(k)}>{l}</button>)}</div>
        <span className="small muted">{shownClients.length === ctx.clients.length ? ctx.clients.length + " clients" : shownClients.length + " of " + ctx.clients.length + " clients"}</span>
      </div>}
      {ctx.clients.length > 0 && !shownClients.length && <div className="card"><Empty>No client matches. <button className="btn sm link" onClick={() => { setCq(""); setCf("all"); }}>Clear the search</button></Empty></div>}
      {shownClients.map((c) => (
        <div className="card" key={c.id}>
          <div className="row between top">
            <div><h2>{c.name} {c.code && <span className="badge ink">{c.code}</span>} {!c.active && <span className="badge red">inactive</span>} {c.can_edit === false && !ro && <span className="badge amber" title="This client was shared with you view-only.">shared · view only</span>}</h2>
              <div className="sub">Default follow-up after a claim is worked: {c.follow_up_days} days · added {fmtDate(new Date(c.created_at).toISOString().slice(0, 10))}</div></div>
            {c.can_edit === false && <div className="row" style={{ gap: 6 }}>{c.responsible_me && <span className="badge teal">you are responsible here</span>}{!ro && <button className="btn sm" onClick={() => setHist(c)}>Change history</button>}</div>}
            {c.can_edit !== false && <div className="row" style={{ gap: 6 }}>{c.responsible_me && <span className="badge teal">you are responsible here</span>}<button className="btn sm" onClick={() => setHist(c)}>Change history</button><button className="btn sm" onClick={() => setProf({ client: c })}>Edit profile</button>{go && <button className="btn sm" onClick={() => go("client", { client_id: c.id })}>Open Client 360</button>}{!isSmeUI(me) && <button className="btn sm link" style={{ color: "var(--red-ink)" }} onClick={() => { setDelTyped(""); setDel(c); }}>Delete</button>}</div>}
          </div>
          {!ro && <div className="od-box mt8">
            <div className="small od-line"><b>OneDrive:</b> {c.od && c.od.link ? <>
                <span className="muted">Brahmastra Clients › {c.name}</span>
                <a className="btn sm" href={c.od.link} target="_blank" rel="noopener">Open folder</a>
                {c.od.inventory && <a className="btn sm" href={c.od.inventory} target="_blank" rel="noopener">Inventory</a>}</>
              : <><span className={c.od && c.od.status && c.od.status.ok === false ? "red-ink" : "muted"}>{c.od && c.od.status && c.od.status.ok === false ? "the folders could not be made: " + String(c.od.status.error || "").slice(0, 140) : "folders are being made (within the hour)"}</span>
                {c.can_edit !== false && <button className="btn sm" disabled={busy} onClick={() => makeFolders(c)}>Make folders now</button>}</>}</div>
            {c.od && c.od.scopes && Object.keys(c.od.scopes).length > 0 && <table className="od-files"><tbody>
              {PROD_SCOPES.filter(([k]) => !(c.scope_of_work || []).length || (c.scope_of_work || []).includes(k)).map(([k, l]) => { const sc = c.od.scopes[k] || {}; const st = wbStatus(k === "ar" ? c.id : c.id + ":" + k); return (
                <tr key={k}><td className="b">{l} production</td>
                  <td className="small"><span className="mono">{sc.path || "Brahmastra Clients › " + c.name + " › Production › " + PROD_FOLDER[k]}</span>
                    <div className="tiny muted">this month: {PROD_FOLDER[k]} Production - {c.name} - {new Date().toLocaleString("en-US", { month: "short" })} {new Date().getFullYear()}.xlsx{st ? (st.ok ? " · last row " + fmtWhen(st.at) : "") : " · no rows yet"}{st && !st.ok ? <span className="red-ink"> · last copy failed: {String(st.error || "").slice(0, 120)}</span> : null}</div></td>
                  <td style={{ textAlign: "right" }}>{sc.link && <a className="btn sm" href={sc.link} target="_blank" rel="noopener">Open</a>}</td></tr>); })}
            </tbody></table>}
          </div>}
          <div className="small mt8"><b>Scope of work:</b> {(c.scope_of_work || []).length ? (c.scope_of_work || []).map((k) => <span key={k} className="badge teal" style={{ marginRight: 4 }}>{SERVICE_UI_NAME[k]}{c.targets && c.targets[k] ? " · " + c.targets[k] + " a day" : ""}</span>) : <span className="muted">not set</span>}</div>
          {(c.profile_gaps || []).length > 0 && <div className="alert warn mt8" style={{ fontSize: 13 }}><b>Profile incomplete:</b> {c.profile_gaps.join(", ")}. {c.can_edit !== false ? <button className="btn link sm" style={{ padding: 0 }} onClick={() => setProf({ client: c })}>Complete it</button> : "A supervisor completes it."}</div>}
          <ResponsibilityRow c={c} dept="ar" ctx={ctx} onSaved={reload} readOnly={c.can_edit === false} />
          <ClientPeople c={c} ctx={ctx} dir={dir} ro={c.can_edit === false} onSaved={reload} focus={params && params.client_id === c.id && params.focus === "people"} />
          <ResponsibilityRow c={c} dept="posting" ctx={ctx} onSaved={reload} readOnly={c.can_edit === false} />
          <ResponsibilityRow c={c} dept="submission" ctx={ctx} onSaved={reload} readOnly={c.can_edit === false} />
          <ResponsibilityRow c={c} dept="subcheck" ctx={ctx} onSaved={reload} me={me} readOnly={c.can_edit === false} />
          <ResponsibilityRow c={c} dept="rejection" ctx={ctx} onSaved={reload} readOnly={c.can_edit === false} />
          <AccessRow c={c} ctx={ctx} me={me} onSaved={reload} dir={dir} />
          <div className="row mt" style={{ alignItems: "flex-start" }}>
            <div className="pill-list" style={{ flex: 1 }}>
              {c.locations.map((l) => <span key={l.id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><span className={"chip " + (l.active ? "on" : "")} title={c.can_edit === false ? undefined : l.active ? "Click to deactivate" : "Click to reactivate"} onClick={c.can_edit === false ? undefined : () => toggleLoc(l)}>{l.name}{!l.active ? " (off)" : ""}</span></span>)}
              {!c.locations.length && <span className="muted small">No locations yet.</span>}
            </div>
            {c.can_edit !== false && <div className="row" style={{ gap: 6 }}>
              <input className="input sm" placeholder="New location name" value={locName[c.id] || ""} onChange={(e) => setLocName({ ...locName, [c.id]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") addLoc(c); }} style={{ width: 200 }} />
              <button className="btn sm" onClick={() => addLoc(c)}>Add location</button>
            </div>}
          </div>
        </div>
      ))}
      {hist && <ClientHistory c={hist} onClose={() => setHist(null)} />}
      {prof && <ClientProfileForm ctx={ctx} client={prof.client} onClose={() => setProf(null)} onSaved={() => { setProf(null); reload(); }} />}
      {edit && (
        <Modal title={edit.id ? "Edit client" : "New client"} onClose={() => setEdit(null)} narrow footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || !edit.name.trim()}>{busy ? "Saving…" : "Save"}</button></>}>
          <div className="stack">
            <Field label="Client name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <div className="grid g2">
              <Field label="Short code" hint="Shown on badges and reports"><input className="input" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} maxLength={12} /></Field>
              <Field label="Default follow-up (days)" hint="Used when a status code has no follow-up of its own"><input className="input" type="number" min={1} max={365} value={edit.follow_up_days} onChange={(e) => setEdit({ ...edit, follow_up_days: e.target.value })} /></Field>
            </div>
            <Field label="OneDrive workbook where billers' work is copied (optional)" hint="Leave empty and Brahmastra saves it by itself in Brahmastra Reports › team lead › client › Production, one file a month. Paste a link only to keep using an existing workbook."><input className="input" value={edit.workbook_link || ""} onChange={(e) => setEdit({ ...edit, workbook_link: e.target.value })} placeholder="https://…/Billers-work.xlsx" /></Field>
            {edit.id && <label className="check"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active (inactive clients are hidden from uploads and allocation)</label>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- Microsoft 365 / OneDrive (the Brahmastra app registration from the previous build) ---------- */
const MS_CFG = { clientId: CFG.MS_CLIENT_ID || "", tenantId: CFG.MS_TENANT_ID || "common", redirectUri: CFG.MS_REDIRECT_URI || (location.origin + location.pathname), scopes: ["User.Read", "Files.ReadWrite.All"] };
const GRAPH = "https://graph.microsoft.com/v1.0";
const msMock = () => window.__BRAHMASTRA_MS_MOCK || null;
// Microsoft only sends people back to the address registered for the app, so sign in works on the team site, not on a copy hosted elsewhere.
function msSupported() {
  if (msMock()) return true;
  try { return !!(window.msal && window.msal.PublicClientApplication) && !!MS_CFG.clientId && location.origin === new URL(MS_CFG.redirectUri).origin; } catch (e) { return false; }
}
let MSAL_P = null;
function msalApp() {
  if (!MSAL_P) {
    const app = new window.msal.PublicClientApplication({ auth: { clientId: MS_CFG.clientId, authority: "https://login.microsoftonline.com/" + MS_CFG.tenantId, redirectUri: MS_CFG.redirectUri }, cache: { cacheLocation: "localStorage" }, system: { popupBridgeTimeout: 300000 } });
    const p = app.initialize().then(() => app);
    p.catch(() => { if (MSAL_P === p) MSAL_P = null; });
    MSAL_P = p;
  }
  return MSAL_P;
}
function msError(kind, message, status) { const e = new Error(message); e.kind = kind; e.status = status || 0; return e; }
function graphError(status, body) {
  const code = (body && body.error && body.error.code) || "";
  if (status === 401) return msError("auth", "Microsoft asked you to sign in again. Click Open OneDrive once more.", status);
  if (status === 403) return msError("denied", "You do not have access to this in OneDrive yet. Ask whoever looks after the Purview Automate folder to share it with you.", status);
  if (status === 404) return msError("missing", "OneDrive could not find it. The file or folder may have been moved, renamed or deleted.", status);
  if (status === 423) return msError("locked", "The file is locked in OneDrive right now (it may be open in Excel). Wait a minute and try again.", status);
  if (status === 429 || status >= 500) return msError("busy", "Microsoft is busy right now. Wait a minute and try again.", status);
  return msError("other", "OneDrive turned this down (" + status + (code ? ", " + code : "") + "). Try again.", status);
}
function msalMessage(e) {
  if (e && e.kind) return e.message;
  const code = String((e && (e.errorCode || e.code)) || "");
  const text = String((e && (e.errorMessage || e.message)) || "");
  if (code === "user_cancelled") return "Microsoft sign in was closed before it finished.";
  if (code === "popup_window_error" || code === "empty_window_error") return "Your browser blocked the Microsoft sign in window. Allow pop-ups for this site, then click again.";
  if (code === "timed_out") return "Microsoft sign in took too long. Click again to retry.";
  if (code === "interaction_in_progress") return "A Microsoft sign in window is already open. Finish it there, or close it and click again.";
  if (/AADSTS65001|AADSTS90094|AADSTS90008|consent|approval/i.test(text)) return "Microsoft needs an admin to approve Brahmastra for Purview first (Entra ID → App registrations → Brahmastra → API permissions → Grant admin consent).";
  if (/AADSTS50020|AADSTS50034|AADSTS50177|AADSTS700016|not exist in tenant/i.test(text)) return "That Microsoft account is not part of the Purview directory. Sign in with your Purview work account.";
  if (/AADSTS50011|AADSTS50194|reply url|redirect/i.test(text)) return "Microsoft did not accept this page's address. The Brahmastra app registration needs " + MS_CFG.redirectUri + " as a single-page application redirect URI.";
  if (/AADSTS50076|AADSTS50079|multi-?factor|\bmfa\b/i.test(text)) return "Microsoft needs you to finish multi-factor sign in. Click again and complete it in the window.";
  return "Microsoft sign in did not finish" + (code ? " (" + code + ")" : text ? " (" + text.slice(0, 80) + ")" : "") + ". Try again.";
}
const msx = {
  async account() { const m = msMock(); if (m) return m.account ? m.account() : null; const app = await msalApp(); return app.getActiveAccount() || app.getAllAccounts()[0] || null; },
  async signIn(hint) {
    const m = msMock(); if (m) return m.signIn(hint);
    const app = await msalApp();
    const r = await app.loginPopup({ scopes: MS_CFG.scopes, loginHint: hint || undefined, prompt: "select_account", overrideInteractionInProgress: true });
    app.setActiveAccount(r.account);
    return r.account;
  },
  async token() {
    const m = msMock(); if (m) return m.token();
    const app = await msalApp();
    const acct = app.getActiveAccount() || app.getAllAccounts()[0];
    if (!acct) throw msError("signin", "Sign in to Microsoft first.");
    try { return (await app.acquireTokenSilent({ scopes: MS_CFG.scopes, account: acct })).accessToken; }
    catch (e) { const r = await app.acquireTokenPopup({ scopes: MS_CFG.scopes, account: acct, overrideInteractionInProgress: true }); app.setActiveAccount(r.account); return r.accessToken; }
  },
  async forget() {
    const m = msMock(); if (m) { if (m.forget) await m.forget(); return; }
    const app = await msalApp();
    const acct = app.getActiveAccount() || app.getAllAccounts()[0];
    app.setActiveAccount(null);
    if (acct) { try { await app.clearCache({ account: acct }); } catch (e) {} }
  },
  async request(url, opts = {}, auth = true) {
    const m = msMock();
    const doFetch = (m && m.fetch) || ((u, o) => fetch(u, o));
    const headers = { ...(opts.headers || {}) };
    if (auth) headers.Authorization = "Bearer " + (await msx.token());
    let r;
    try { r = await doFetch(url, { method: opts.method || "GET", headers, body: opts.body }); }
    catch (e) { throw msError("network", "Could not reach Microsoft. Check your connection and try again."); }
    if (!r.ok) { let j = null; try { j = await r.json(); } catch (e) {} throw graphError(r.status, j); }
    return r;
  },
  async graph(path, opts = {}) { const r = await msx.request(GRAPH + path, opts, true); if (r.status === 204) return null; return r.json(); },
  // OneDrive's short-lived download address is already signed, so it is fetched with no Authorization header.
  async download(url) { const r = await msx.request(url, {}, false); return new Uint8Array(await r.arrayBuffer()); },
};
function shareIdOf(link) { const b64 = btoa(unescape(encodeURIComponent(String(link).trim()))); return "u!" + b64.replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-"); }
function itemSummary(it) {
  const who = it && it.lastModifiedBy && (it.lastModifiedBy.user || it.lastModifiedBy.application);
  return { name: (it && it.name) || "", webUrl: (it && it.webUrl) || "", size: (it && it.size) || 0, modifiedAt: it && it.lastModifiedDateTime ? Date.parse(it.lastModifiedDateTime) : null, modifiedBy: (who && (who.displayName || who.email)) || "" };
}
const isSheetFile = (name) => /\.(xlsx|xlsm|xls|csv|tsv|txt)$/i.test(name || "");
const ITEM_FIELDS = "id,name,size,folder,file,lastModifiedDateTime,lastModifiedBy,webUrl,parentReference,remoteItem";
const driveIdOf = (it) => (it && it.parentReference && it.parentReference.driveId) || "";
const msItemFromLink = (link) => msx.graph("/shares/" + shareIdOf(link) + "/driveItem?$select=" + ITEM_FIELDS);
async function msRootItem() {
  const it = await msx.graph("/me/drive/root?$select=" + ITEM_FIELDS);
  if (!driveIdOf(it)) { const d = await msx.graph("/me/drive?$select=id"); it.parentReference = { ...(it.parentReference || {}), driveId: d.id }; }
  return it;
}
async function msChildren(driveId, itemId) { const j = await msx.graph(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children?$top=500&$select=${ITEM_FIELDS}&$orderby=name`); return j.value || []; }
async function msDownloadItem(driveId, itemId) {
  const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
  const it = await msx.graph(`${base}?$select=${ITEM_FIELDS},@microsoft.graph.downloadUrl`);
  let url = it["@microsoft.graph.downloadUrl"];
  // Sometimes OneDrive leaves the short-lived link out; the content address always works with the token.
  if (!url) { const r = await msx.request(GRAPH + base + "/content", {}, true); return { bytes: new Uint8Array(await r.arrayBuffer()), info: itemSummary(it) }; }
  return { bytes: await msx.download(url), info: itemSummary(it) };
}
const fmtBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace(/\.0$/, "") + " MB" : Math.max(1, Math.round((n || 0) / 1024)) + " KB");
/* Browse OneDrive (the pinned Purview Automate folder, or the signed-in person's files) and pick a spreadsheet. */
function OneDrivePicker({ folderLink, onPick, onClose, accept = isSheetFile, what = "spreadsheet" }) {
  const [acct, setAcct] = useState(null);
  const [stack, setStack] = useState([]);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState("Signing in to Microsoft…");
  const [err, setErr] = useState(null);
  const [link, setLink] = useState("");
  const nodeOf = (it) => (it.remoteItem ? { driveId: driveIdOf(it.remoteItem) || driveIdOf(it), id: it.remoteItem.id, name: it.name, webUrl: it.webUrl } : { driveId: driveIdOf(it), id: it.id, name: it.name === "root" || !it.name ? "My files" : it.name, webUrl: it.webUrl });
  const load = async (node) => {
    setBusy("Loading " + node.name + "…"); setErr(null);
    try { const kids = await msChildren(node.driveId, node.id); setItems(kids.filter((k) => k.folder || accept(k.name)).sort((a, b) => (!!b.folder - !!a.folder) || String(a.name).localeCompare(String(b.name)))); }
    catch (e) { setErr(msalMessage(e)); }
    setBusy(null);
  };
  const openNode = async (node, replace) => { setStack((s) => (replace ? [node] : [...s, node])); await load(node); };
  const pickFile = async (it) => {
    setBusy("Downloading " + it.name + "…"); setErr(null);
    try { const d = await msDownloadItem(driveIdOf(it), it.id); await onPick({ bytes: d.bytes, name: d.info.name || it.name, webUrl: d.info.webUrl || it.webUrl, modifiedAt: d.info.modifiedAt, modifiedBy: d.info.modifiedBy }); }
    catch (e) { setErr(msalMessage(e)); setBusy(null); }
  };
  const start = async () => {
    setBusy("Signing in to Microsoft…"); setErr(null);
    try {
      let a = await msx.account(); if (!a) a = await msx.signIn(); setAcct(a);
      let it = null;
      if (folderLink) { try { it = await msItemFromLink(folderLink); } catch (e) { setErr("The pinned folder did not open (" + msalMessage(e) + "). Showing your OneDrive instead."); } }
      if (it && !it.folder) { await pickFile(it); return; }
      if (!it) it = await msRootItem();
      await openNode(nodeOf(it), true);
    } catch (e) { setErr(msalMessage(e)); setBusy(null); }
  };
  useEffect(() => { start(); }, []);
  const openLink = async () => {
    if (!/^https:\/\//i.test(link.trim())) { setErr("Paste the whole OneDrive link, starting with https://"); return; }
    setBusy("Opening the link…"); setErr(null);
    try { const it = await msItemFromLink(link.trim()); if (it.folder) await openNode(nodeOf(it), true); else await pickFile(it); }
    catch (e) { setErr(msalMessage(e)); setBusy(null); }
  };
  const switchAccount = async () => { try { await msx.forget(); setAcct(null); setStack([]); setItems([]); await start(); } catch (e) { setErr(msalMessage(e)); } };
  const click = (it) => { if (busy) return; if (it.folder) openNode(nodeOf(it)); else pickFile(it); };
  const here = stack[stack.length - 1];
  return (
    <Modal title="Open from OneDrive" sub={acct ? "Signed in as " + (acct.username || acct.name || "") : "Microsoft sign in"} onClose={onClose} wide>
      <div className="stack">
        <div className="row between">
          <div className="row" style={{ gap: 4 }}>{stack.map((n, i) => <React.Fragment key={n.id + i}>{i > 0 && <span className="muted">›</span>}<button className="btn sm link" disabled={!!busy} onClick={() => { setStack(stack.slice(0, i + 1)); load(n); }}>{n.name}</button></React.Fragment>)}</div>
          <div className="row">{here && here.webUrl && <a className="btn sm link" href={here.webUrl} target="_blank" rel="noopener">Open this folder in OneDrive</a>}{acct && <button className="btn sm link" onClick={switchAccount} disabled={!!busy}>Switch account</button>}</div>
        </div>
        <div className="row"><input className="input sm" style={{ flex: 1 }} placeholder="or paste a OneDrive link to a folder or an Excel file" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") openLink(); }} /><button className="btn sm" onClick={openLink} disabled={!!busy}>Open link</button></div>
        <ErrorBox error={err} />
        {busy && <Spinner label={busy} />}
        {!busy && <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t"><thead><tr><th>Name</th><th>Modified</th><th>By</th><th className="r">Size</th></tr></thead>
          <tbody>{items.map((it) => <tr key={it.id} className="click" onClick={() => click(it)}><td>{it.folder ? "📁 " : "📄 "}{it.name}{it.folder && it.folder.childCount != null ? <span className="tiny muted"> · {it.folder.childCount} items</span> : null}</td><td className="small">{it.lastModifiedDateTime ? fmtWhen(Date.parse(it.lastModifiedDateTime)) : ""}</td><td className="small">{itemSummary(it).modifiedBy}</td><td className="num">{it.file ? fmtBytes(it.size) : ""}</td></tr>)}
            {!items.length && <tr><td colSpan={4}><Empty>{"No folders or " + what + " files here."}</Empty></td></tr>}</tbody></table></div>}
        <div className="tiny muted">{what === "spreadsheet" ? "Only folders and Excel/CSV files are listed." : "Only folders and " + what + " files are listed."} Click a file and it is read on the spot; nothing is written back to OneDrive.</div>
      </div>
    </Modal>
  );
}
/* Pin the Purview Automate inventory folder so the picker opens straight into it. */
function PinFolderModal({ me, current, onClose, onSaved }) {
  const [link, setLink] = useState(current || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const info = { link: link.trim(), name: "", webUrl: "", by: me.name || me.email, at: Date.now() };
      if (info.link && msSupported()) {
        try { let a = await msx.account(); if (!a) a = await msx.signIn(); const it = await msItemFromLink(info.link); info.name = it.name; info.webUrl = it.webUrl; info.isFolder = !!it.folder; }
        catch (e) { setErr("The link is saved, but it could not be opened right now: " + msalMessage(e)); }
      }
      await rpc("settings.save", { settings: { onedrive_folder: info.link ? info : null } });
      toast(info.link ? "OneDrive folder pinned." : "OneDrive folder cleared.");
      onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title="Purview Automate OneDrive folder" sub="Paste the sharing link of the inventory folder (OneDrive → folder → Share → Copy link). Everyone's picker opens there." onClose={onClose} narrow footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="stack">
        <Field label="Folder link"><input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://purviewhealthcare-my.sharepoint.com/…" /></Field>
        <ErrorBox error={err} />
        <div className="tiny muted">Leave it empty to clear the pin. The link is kept on the server, so every team lead and biller gets the same folder.</div>
      </div>
    </Modal>
  );
}

/* ---------- automatic allocation: every open claim of a client / location goes to the billers mapped to it ---------- */
async function autoAllocate({ ctx, client, loc }) {
  // The client's people (the location's own team when it has one), minus anyone out today, each up to their daily target.
  let dt = null; try { dt = await rpc("team.today", { client_id: client.id, location_id: loc ? loc.id : undefined, day: todayISO() }); } catch (e) {}
  const members = dt ? dt.members : [];
  const users = members.filter((m) => !m.out);
  const capOf = Object.fromEntries(members.map((m) => [m.id, Number(m.cap) || 35]));
  const offToday = new Set(members.filter((m) => m.out).map((m) => m.id));
  if (!users.length) return { applied: 0, perUser: [], reason: offToday.size ? "everyone on the client is out today" : "no people on the client yet" };
  const today = todayISO();
  const el = await rpc("claims.eligible", { client_id: client.id, location_id: loc ? loc.id : undefined });
  const pool = rescore(el.claims.filter((c) => (loc ? c.location_id === loc.id : !c.location_id)), today);
  if (!pool.length) return { applied: 0, perUser: [], reason: "no open claims" };
  const cap = Math.ceil(pool.length / users.length) + 1;
  const plan = planAllocation({ claims: pool, users: users.map((u) => ({ id: u.id, name: u.name, capacity: capOf[u.id] != null ? capOf[u.id] : cap })), strategy: "smart" });
  let applied = 0;
  for (const part of chunk(plan.assignments, 300)) { const r = await rpc("alloc.apply", { client_id: client.id, location_id: loc ? loc.id : undefined, strategy: "auto", assignments: part, summary: { auto: true, perUser: plan.perUser } }); applied += r.applied; }
  return { applied, perUser: plan.perUser };
}


/* ---------- the day's team for a project: who receives claims today, and how many ---------- */
const STATUS_TONE = { working: "green", ojt: "blue", training: "blue", sabbatical: "amber", "serving notice": "red" };
function ProjectMapModal({ names, clients, onDone, onClose, canCreate }) {
  const guess = (n) => { const k = String(n).toLowerCase().replace(/[^a-z0-9]/g, ""); const hit = clients.filter((c) => { const a = c.name.toLowerCase().replace(/[^a-z0-9]/g, ""), b = String(c.code || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return a.includes(k) || k.includes(a) || (b && (b === k || a.startsWith(k))); }); return hit.length === 1 ? hit[0].id : ""; };
  const [pick, setPick] = useState(() => Object.fromEntries(names.map((n) => [n, guess(n)])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      let n = 0;
      for (const name of names) { const v = pick[name]; if (!v) continue; await rpc("projects.map", v === "__new" ? { name, create: true } : { name, client_id: v }); n++; }
      toast(n ? `${n} project${n > 1 ? "s" : ""} matched.` : "Nothing matched yet.");
      onDone && onDone();
    } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  return (
    <Modal title="Match roster projects to clients" sub="These projects come from the Purview Shastra roster but do not match a client here by name. Pick the client each one is, or create it. People on a project get its claims and access once it is matched." onClose={onClose}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Later</button><button className="btn primary" onClick={save} disabled={busy || !Object.values(pick).some(Boolean)}>{busy ? "Saving…" : "Confirm"}</button></>}>
      <table className="t"><thead><tr><th>Roster project</th><th>Brahmastra client</th></tr></thead>
        <tbody>{names.map((n) => <tr key={n}><td><b>{n}</b></td><td><Combo value={pick[n] || ""} onChange={(v) => setPick({ ...pick, [n]: v })} placeholder="Not sure yet"
          options={[{ id: "", label: "Not sure yet" }, ...clients.map((c) => ({ id: c.id, label: c.name + (c.code ? ` (${c.code})` : "") })), ...(canCreate ? [{ id: "__new", label: `+ Create a new client called "${n}"` }] : [])]} />
          {pick[n] && pick[n] !== "__new" && guess(n) === pick[n] && <div className="tiny muted">suggested from the name, please confirm</div>}</td></tr>)}</tbody></table>
    </Modal>
  );
}
/* ---------- admin: the roster from Purview Shastra, extra sign-in emails, project matches ---------- */
const ACCESS_LABEL = { agent: "Biller", lead: "TL / SME", manager: "Manager", all: "Every project" };
const ACTION_TONE = { new: "green", update: "blue", same: "gray" };
/* Purview Shastra sends the roster by itself every hour; Sync now does it at once. Changes apply straight away. */
function ShastraSync({ data, onDone }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const last = data.last, log = data.log || [];
  const sync = async () => {
    setBusy(true);
    try { const r = await rpc("roster.syncShastra"); const m = r.summary; toast((m.new + m.updated + m.deactivated ? `From Shastra: ${m.new} joined, ${m.updated} changed, ${m.deactivated} left.` : "Already up to date with Shastra.") + (r.removed ? ` ${r.removed} old roster ${r.removed === 1 ? "entry" : "entries"} removed.` : "")); onDone(r); }
    catch (e) { toast(e.message, "err"); onDone(null); }
    setBusy(false);
  };
  const what = (e) => e.action === "new" ? "joined" : e.action === "left" ? "left" : e.changes && e.changes.length ? e.changes.map((c) => c.replace(/_name$/, "").replace(/_/g, " ")).join(", ") : "updated";
  return (
    <div className="card stack">
      <div className="row between">
        <div><h3>Purview Shastra</h3>
          <div className="small muted">{!data.connected ? "Not connected yet. Once the SHASTRA_FEED_KEY secret is added, the roster updates by itself every hour."
            : !last ? "Connected. The first update runs within the hour, or click Sync now."
            : last.ok ? <>Updated by itself every hour · last {fmtWhen(last.at)}{last.by && last.by !== "hourly" ? " (by " + last.by + ")" : ""} · {fmtInt(last.people)} people{last.new + last.updated + last.deactivated ? <> · {last.new} joined, {last.updated} changed, {last.deactivated} left</> : " · no changes"}{last.removed ? <> · {last.removed} old roster {last.removed === 1 ? "entry" : "entries"} removed</> : null}</>
            : <span style={{ color: "var(--red-ink)" }}>Last try {fmtWhen(last.at)} did not work: {last.error}</span>}</div></div>
        <div className="row">{log.length > 0 && <button className="btn sm" onClick={() => setOpen(!open)}>{open ? "Hide changes" : "What changed"}</button>}
          <button className="btn primary" disabled={!data.connected || busy} onClick={sync}>{busy ? "Syncing…" : "Sync now"}</button></div>
      </div>
      {open && <div className="table-wrap" style={{ maxHeight: 320 }}><table className="t"><thead><tr><th>When</th><th>Joined</th><th>Changed</th><th>Left</th><th>Who</th></tr></thead>
        <tbody>{log.map((l, i) => <tr key={i}><td className="small">{fmtWhen(l.at)}</td><td className="num">{l.new}</td><td className="num">{l.updated}</td><td className="num">{l.deactivated}</td>
          <td className="small">{(l.names || []).slice(0, 12).map((e) => e.name + " (" + what(e) + ")").join(" · ") || "–"}{(l.names || []).length > 12 ? " …" : ""}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
function RosterView({ ctx, reload, me }) {
  const meta = useRpc("roster.meta", {}, []);
  const [preview, setPreview] = useState(null);
  const [tab, setTab] = useState("people");
  const [busy, setBusy] = useState(null);
  const [emails, setEmails] = useState(null);
  useEffect(() => { if (meta.data && emails == null) setEmails(meta.data.extra_emails.join("\n")); }, [meta.data]);
  const saveEmails = async () => { setBusy("Saving…"); try { const r = await rpc("roster.saveEmails", { emails }); setEmails(r.extra_emails.join("\n")); toast("Saved: " + r.extra_emails.length + " extra email(s) can sign in."); meta.reload(); } catch (e) { toast(e.message, "err"); } setBusy(null); };
  const remap = async (name, v) => { setBusy("Saving…"); try { await rpc("projects.map", v === "__new" ? { name, create: true } : { name, client_id: v }); toast(name + " matched."); meta.reload(); await reload(); } catch (e) { toast(e.message, "err"); } setBusy(null); };
  const projOptions = ctx.clients;
  const last = meta.data && meta.data.shastra && meta.data.shastra.last;
  return (
    <div className="stack">
      <div><h1>Roster</h1><div className="sub">Everyone in Brahmastra comes from Purview Shastra: who reports to whom, departments, projects, status and date of joining. It updates by itself every hour; change people in Shastra, not here.</div></div>
      <ShastraSync data={meta.data && meta.data.shastra} onDone={(r) => { if (r) { setPreview(r); setTab("people"); } meta.reload(); reload(); }} />
      <div className="tiny muted" style={{ margin: "-4px 4px 0" }}>Access: Agents work claims; SMEs, Team Leads and Sr Team Leads lead their own projects; Assistant Managers, Managers and Sr Managers also see their people's projects; the Vice President sees every project. CEO, Director, HR, IT, Administration, QA, MIS and Tech Support get no access. Only AR agents receive AR claims. Nothing changes until you press Apply.</div>
      {!preview && last && last.emails && last.emails.length > 0 && <div className="alert warn"><b>{last.emails.length} {last.emails.length === 1 ? "person has" : "people have"} an email problem in Shastra</b> and cannot sign in until it is fixed there: {last.emails.slice(0, 8).map((w) => w.name).join(", ")}{last.emails.length > 8 ? " …" : ""}. Click Sync now for the full list.</div>}
      {preview && (
        <div className="card stack">
          <div className="row between"><h3>Details of this sync</h3><button className="btn sm" onClick={() => setPreview(null)}>Hide</button></div>
          <div className="row" style={{ gap: 6 }}>{[["people", `People (${preview.people.length})`], ["warnings", `Emails to fix (${preview.warnings.length})`], ["projects", `Projects (${preview.projects.length})`], ["excluded", `No access (${preview.excluded.length})`], ["leaving", `Leaving (${preview.leaving.length})`]].map(([k, l]) => <button key={k} className={"chip " + (tab === k ? "on" : "")} onClick={() => setTab(k)}>{l}</button>)}</div>
          {tab === "people" && <div className="table-wrap" style={{ maxHeight: 520 }}><table className="t"><thead><tr><th></th><th>Name</th><th>Position · dept</th><th>Access</th><th>Projects</th><th>Reports to</th><th>Status</th><th>Email</th></tr></thead>
            <tbody>{preview.people.map((p, i) => <tr key={i} style={p.active ? undefined : { opacity: 0.55 }}><td><span className={"badge " + (ACTION_TONE[p.action] || "gray")}>{p.action}</span>{p.changes.length ? <div className="tiny muted">{p.changes.join(", ")}</div> : null}</td>
              <td><b>{p.name}</b><div className="tiny muted mono">{p.emp_id || "no emp id"}</div></td><td className="small">{p.position}<div className="tiny muted">{p.department}</div></td><td className="small">{ACCESS_LABEL[p.access] || p.access}</td>
              <td className="small">{p.projects.map((x) => x.name + (x.share != null ? ` ${x.share}%` : "")).join(", ") || "–"}</td><td className="small">{p.reports_to || "–"}</td><td className="small">{p.active ? p.status : <span className="badge red">off</span>}</td>
              <td className="small">{p.email || <span className="badge amber">no email</span>}{p.issues.length ? <div className="tiny" style={{ color: "var(--amber-ink)" }}>{p.issues.join("; ")}</div> : null}</td></tr>)}</tbody></table></div>}
          {tab === "warnings" && <div className="table-wrap"><table className="t"><thead><tr><th>Name</th><th>Emp ID</th><th>Project</th><th>Reports to</th><th>Problem</th></tr></thead>
            <tbody>{preview.warnings.map((w, i) => <tr key={i}><td><b>{w.name}</b></td><td className="mono small">{w.emp_id || "–"}</td><td className="small">{w.project}</td><td className="small">{w.reports_to}</td><td className="small">{w.issues.join("; ")}</td></tr>)}
              {!preview.warnings.length && <tr><td colSpan={5} className="muted">No email problems.</td></tr>}</tbody></table><div className="tiny muted mt8">These people are still loaded with their team and manager; they can sign in once the email is fixed in Shastra (and the roster reloaded), set on the Team screen, or a non-Purview address is allowed below.</div></div>}
          {tab === "projects" && <table className="t"><thead><tr><th>Roster project</th><th>Brahmastra client</th></tr></thead>
            <tbody>{preview.projects.map((p) => <tr key={p.name}><td><b>{p.name}</b></td><td>{p.client ? <>{p.client} {p.state === "auto" && <span className="tiny muted">(same name, matched automatically)</span>}</> : <span className="badge amber">a team lead will be asked to match it</span>}</td></tr>)}</tbody></table>}
          {tab === "excluded" && <table className="t"><thead><tr><th>Name</th><th>Position</th><th>Department</th><th>Why no access</th></tr></thead>
            <tbody>{preview.excluded.map((x, i) => <tr key={i}><td><b>{x.name}</b></td><td className="small">{x.position}</td><td className="small">{x.department}</td><td className="small">{x.reason}{x.existing ? <span className="badge red" style={{ marginLeft: 6 }}>will be switched off</span> : null}</td></tr>)}</tbody></table>}
          {tab === "leaving" && <div>{preview.leaving.length ? <ul>{preview.leaving.map((x, i) => <li key={i}>{x.name} <span className="muted mono small">{x.emp_id}</span></li>)}</ul> : <div className="muted small">Nobody: everyone in Brahmastra is still in Shastra.</div>}<div className="tiny muted">People who are no longer in Shastra are switched off; their open claims go back to the pool. Those who never signed in and have no work in Brahmastra are removed.</div></div>}
        </div>
      )}
      <div className="grid g2">
        <div className="card stack">
          <h3>Projects and clients</h3>
          <div className="small muted">Each roster project is one Brahmastra client. Change a match here; team leads are asked about any project that is not matched.</div>
          {meta.data && <table className="t"><thead><tr><th>Roster project</th><th>Client</th></tr></thead>
            <tbody>{meta.data.projects.map((p) => <tr key={p.name}><td><b>{p.name}</b></td><td><Combo sm clearable={false} value={p.client_id || ""} disabled={!!busy} onChange={(v) => v && remap(p.name, v)} placeholder="Not matched yet"
              options={[{ id: "", label: "Not matched yet" }, ...projOptions.map((c) => ({ id: c.id, label: c.name })), { id: "__new", label: `+ Create a client called "${p.name}"` }]} /></td></tr>)}
              {!meta.data.projects.length && <tr><td colSpan={2} className="muted">Click Sync now first.</td></tr>}</tbody></table>}
        </div>
        <div className="card stack">
          <h3>Extra sign-in emails</h3>
          <div className="small muted">People from the roster sign in with a Purview address. List any other address (for example a Gmail) that may sign in, one per line.</div>
          <textarea className="textarea" style={{ minHeight: 140 }} value={emails || ""} onChange={(e) => setEmails(e.target.value)} placeholder="name@gmail.com" />
          <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn primary" disabled={!!busy || emails == null} onClick={saveEmails}>Save emails</button></div>
          {meta.data && meta.data.admins.length > 0 && <div className="tiny muted">Admins: {meta.data.admins.join(", ")} (set in the Worker settings, ADMIN_EMAILS).</div>}
        </div>
      </div>
    </div>
  );
}
/* ---------- locations: which billers work which client and location ---------- */
function LocationsView({ ctx, reload, go, embedded }) {
  const people = [...ctx.users].filter((u) => u.active).sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "user" ? -1 : 1));
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const rows = [];
  ctx.clients.filter((c) => c.active).forEach((c) => {
    rows.push({ key: "c:" + c.id, client: c, loc: null, team: c.team || [], auto: c.auto_allocate !== false });
    c.locations.filter((l) => l.active).forEach((l) => rows.push({ key: "l:" + l.id, client: c, loc: l, team: l.team || [], auto: l.auto_allocate !== false }));
  });
  const get = (r) => draft[r.key] || { team: r.team, auto: r.auto };
  const dirty = (r) => !!draft[r.key] && (JSON.stringify([...draft[r.key].team].sort()) !== JSON.stringify([...r.team].sort()) || draft[r.key].auto !== r.auto);
  const toggle = (r, uid) => setDraft((d) => { const g = d[r.key] || { team: r.team, auto: r.auto }; return { ...d, [r.key]: { ...g, team: g.team.includes(uid) ? g.team.filter((x) => x !== uid) : [...g.team, uid] } }; });
  const setAuto = (r, v) => setDraft((d) => ({ ...d, [r.key]: { ...(d[r.key] || { team: r.team, auto: r.auto }), auto: v } }));
  const save = async (r) => {
    setBusy(r.key);
    try { await rpc("clients.saveTeam", { client_id: r.client.id, location_id: r.loc ? r.loc.id : undefined, team: get(r).team, auto_allocate: get(r).auto }); toast("Saved."); const d = { ...draft }; delete d[r.key]; setDraft(d); reload(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(null);
  };
  const allocateNow = async (r) => {
    setBusy(r.key);
    try {
      const team = get(r).team;
      const res = await autoAllocate({ ctx, client: { ...r.client, team: r.loc ? r.client.team : team }, loc: r.loc ? { ...r.loc, team } : null });
      toast(res.applied ? `Assigned ${fmtInt(res.applied)} claims: ` + res.perUser.filter((u) => u.count).map((u) => `${u.name} ${fmtInt(u.count)}`).join(", ") : "Nothing to assign: " + (res.reason || "no open claims") + ".");
    } catch (e) { toast(e.message, "err"); }
    setBusy(null);
  };
  return (
    <div className="stack">
      <div>{!embedded && <h1>Locations</h1>}<div className="sub">Map billers to each client and location. When inventory is loaded for a location, its open claims are handed to these billers at once (evenly, highest priority first, patients and payers kept together). A team lead can still move claims on Allocate or Claims.</div></div>
      {!rows.length && <div className="card"><Empty>No clients yet. <button className="btn link sm" onClick={() => go("clients")}>Add clients and locations</button> first.</Empty></div>}
      {rows.length > 0 && (
        <div className="card tight">
          <div className="table-wrap"><table className="t"><thead><tr><th>Client</th><th>Location</th><th>Billers</th><th>Allocate on upload</th><th></th></tr></thead>
            <tbody>{rows.map((r) => { const g = get(r); return (
              <tr key={r.key}>
                <td>{r.loc ? <span className="muted">{r.client.name}</span> : <b>{r.client.name}</b>}</td>
                <td>{r.loc ? <b>{r.loc.name}</b> : <span className="tiny muted">client level · used when a location has no billers of its own</span>}</td>
                <td><div className="pill-list">{people.map((u) => <button key={u.id} className={"chip " + (g.team.includes(u.id) ? "on" : "")} onClick={() => toggle(r, u.id)} title={u.role === "supervisor" ? "team lead" : "biller"}>{u.name}{u.role === "supervisor" ? " (TL)" : ""}</button>)}{!people.length && <span className="muted small">No active people yet.</span>}</div></td>
                <td><label className="check small"><input type="checkbox" checked={g.auto} onChange={(e) => setAuto(r, e.target.checked)} /> yes</label></td>
                <td className="r" style={{ whiteSpace: "nowrap" }}>{dirty(r) && <button className="btn sm primary" disabled={busy === r.key} onClick={() => save(r)}>Save</button>} <button className="btn sm" disabled={busy === r.key || !g.team.length || dirty(r)} title={dirty(r) ? "Save first" : "Hand every open claim here to these billers now"} onClick={() => allocateNow(r)}>Allocate open claims now</button></td>
              </tr>); })}</tbody></table></div>
        </div>
      )}
      <div className="small muted">Tip: a location without billers falls back to the client-level billers. Claims already on someone's desk are never moved by automatic allocation. Billers from the roster are added to their projects automatically; Today's team sets who works a project today.</div>
    </div>
  );
}

/* ---------- inventory upload ---------- */
/* Inventory & allocation: upload, upload history and allocation on one tab, picked through cards that say what each is for. */
const INV_TABS = [
  ["upload", "1 · Upload inventory", "Open the client's claim file straight from OneDrive (Excel or CSV) and load it. New claims are added, claims already on file are refreshed, and the location's billers can receive them at once."],
  ["batches", "2 · Upload history", "Every file loaded so far and exactly what it changed: rows read, new, refreshed, reopened, closed. Re-read the same OneDrive file after the client updates it, or undo a wrong upload."],
  ["allocate", "3 · Allocate", "Hand out the day's work: filter the pool (tier, age, payer, balance), pick who works today and how many claims each person gets, preview the split, then apply it."],
  ["details", "+ Patient details report", "Inventory missing patient details? Upload the other report (demographics / PM report): it is matched by claim # or account # and fills the gaps, so there is no VLOOKUP in Excel before allocating."],
];
/* ---------- patient details report ----------
   Some inventory files lack patient details. A second report (demographics / PM system report) is matched to the claims already loaded
   by claim # (or by account #, which fills every claim of that patient) and fills what is missing. */
const DETAIL_FIELD_LABEL = { patient: "Patient name", account_no: "Account # / MRN", payer: "Payer / Insurance", provider: "Provider", patient_dob: "Date of birth", member_id: "Member / subscriber ID", patient_phone: "Phone" };
const DETAIL_TARGETS = ["patient", "account_no", "payer", "provider", "patient_dob", "member_id", "patient_phone"];
const DETAIL_RULES = {
  patient_dob: ["dob", "date of birth", "birth date", "birthdate", "patient dob", "pt dob"],
  member_id: ["member id", "subscriber id", "member number", "policy number", "policy id", "insurance id", "ins id", "id number", "member no", "subscriber number", "medicaid id", "medicare id", "mbi", "hicn"],
  patient_phone: ["phone", "phone number", "patient phone", "home phone", "cell phone", "mobile", "contact number", "telephone"],
};
const DETAIL_WHY = ["Patient names missing", "Account # / MRN missing", "Payer / insurance missing", "DOB / member ID needed for calls", "Provider missing", "Other"];
function detailAutoMap(headers) {
  const m = autoMap(headers);
  const out = { claim_no: m.claim_no || "", account_no: m.account_no || "", patient: m.patient || "", payer: m.payer || "", provider: m.provider || "" };
  const used = new Set(Object.values(out).filter(Boolean));
  for (const [k, names] of Object.entries(DETAIL_RULES)) {
    const hit = headers.find((h) => !used.has(h) && names.includes(normHeader(h))) || headers.find((h) => !used.has(h) && names.filter((n) => n.length >= 5).some((n) => normHeader(h).includes(n)));
    out[k] = hit || ""; if (hit) used.add(hit);
  }
  return out;
}
function DetailsReport({ ctx, go }) {
  const [clientId, setClientId] = useState("");
  const [locId, setLocId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState(null);
  const [table, setTable] = useState(null);
  const [map, setMap] = useState({});
  const [keepOther, setKeepOther] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef();
  const hist = useRpc("inventory.enrichList", { limit: 20 }, []);
  const onFile = async (f) => {
    if (!f) return;
    try {
      const sheets = readWorkbook(await f.arrayBuffer(), f.name);
      if (!sheets.length) throw new Error("No rows were found in this file.");
      const t = tableFromSheet(sheets[0].rows);
      setFile({ name: f.name }); setTable(t); setMap(detailAutoMap(t.headers)); setResult(null);
    } catch (e) { toast("Could not read the file: " + e.message, "err"); }
    if (inputRef.current) inputRef.current.value = "";
  };
  const headerOpts = [{ id: "", label: "(not in this report)" }, ...((table && table.headers) || []).map((h) => ({ id: h, label: h }))];
  const mapped = new Set(Object.values(map).filter(Boolean));
  const others = table ? table.headers.filter((h) => !mapped.has(h)) : [];
  const keyed = table ? table.rows.filter((r) => (map.claim_no && String(r[map.claim_no] ?? "").trim()) || (map.account_no && String(r[map.account_no] ?? "").trim())).length : 0;
  const fills = DETAIL_TARGETS.filter((k) => map[k] && !(k === "account_no" && !map.claim_no));
  const ready = clientId && purpose && table && (map.claim_no || map.account_no) && (fills.length || (keepOther && others.length)) && keyed > 0;
  const run = async () => {
    setBusy("Matching…"); setResult(null);
    const cell = (r, h) => (h ? r[h] : "");
    const rows = table.rows.map((r) => {
      const o = { claim_no: String(cell(r, map.claim_no) ?? "").trim(), account_no: String(cell(r, map.account_no) ?? "").trim() };
      for (const k of DETAIL_TARGETS) if (k !== "account_no" && map[k]) o[k] = String(cell(r, map[k]) ?? "").trim();
      if (o.patient_dob) o.patient_dob = parseDateAny(cell(r, map.patient_dob)) || o.patient_dob;
      if (keepOther) { o.extra = {}; for (const h of others.slice(0, 40)) { const v = r[h]; if (v !== "" && v != null) o.extra[h] = typeof v === "number" && /date|dob/i.test(h) ? (parseDateAny(v) || String(v)) : String(v); } }
      return o;
    }).filter((o) => o.claim_no || o.account_no);
    let uploadId = null, tot = { rows: 0, matched: 0, updated: 0, fields: {} };
    try {
      for (let i = 0; i < rows.length; i += 1000) {
        setBusy(`Filling details… ${fmtInt(Math.min(rows.length, i + 1000))} of ${fmtInt(rows.length)} rows`);
        const r = await rpc("inventory.enrich", { client_id: clientId, location_id: locId || undefined, upload_id: uploadId, file_name: file.name, purpose, note, overwrite, rows: rows.slice(i, i + 1000) });
        uploadId = r.upload_id; tot = { rows: tot.rows + r.rows, matched: tot.matched + r.matched, updated: tot.updated + r.updated, fields: r.fields };
      }
      setResult({ ...tot, upload_id: uploadId }); hist.reload();
      toast(`${fmtInt(tot.updated)} claims filled from ${file.name}.`);
    } catch (e) { toast(e.message, "err"); }
    setBusy(null);
  };
  const lastUnmatched = result && hist.data ? (hist.data.rows.find((h) => h.id === result.upload_id) || {}).unmatched || [] : [];
  return (
    <div className="stack">
      <div className="card">
        <div className="b">Why upload a patient details report?</div>
        <div className="small mt8" style={{ lineHeight: 1.6 }}>Some clients' inventory files do not carry the full patient details (patient name, account #, payer, DOB, member ID…). Until now that meant pulling a second report and matching it in Excel before allocating. Upload that report here instead:
          <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
            <li><b>Better allocation:</b> with the patient and account filled, all of a patient's claims are kept with one biller and payers are batched, so one call covers several claims.</li>
            <li><b>Faster work:</b> the biller sees DOB, member ID and phone on the claim, without opening another report before calling the payer.</li>
            <li><b>No VLOOKUP:</b> rows are matched by claim # first, otherwise by account # (which fills every claim of that patient). Nothing else on the claim changes, and each claim's history shows what was filled and why.</li>
          </ul></div>
        <div className="tiny muted mt8">Load the inventory first (step 1), then this report for the same client. Rows that match no claim are listed so you can check them.</div>
      </div>
      <div className="card">
        <div className="grid g4">
          <ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} locId={locId} setLocId={setLocId} />
          <Field label="Why are you uploading this report?"><Combo value={purpose} onChange={setPurpose} placeholder="Pick the reason…" options={DETAIL_WHY.map((x) => ({ id: x, label: x }))} /></Field>
          <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Kareo demographics report, Oct 29" /></Field>
        </div>
        <div className="row mt8" style={{ gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => inputRef.current && inputRef.current.click()}>📄 {file ? "Pick another report" : "Pick the report (Excel or CSV)"}</button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsm,.csv,.txt" style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0])} />
          {file && table && <span className="small">{file.name} · {fmtInt(table.rows.length)} rows · {fmtInt(keyed)} with a claim # or account #</span>}
        </div>
        {table && <>
          <div className="b small mt16 mb">Columns in this report</div>
          <div className="grid g4">
            <Field label="Claim # (to match)"><Combo value={map.claim_no} onChange={(v) => setMap({ ...map, claim_no: v })} options={headerOpts} /></Field>
            {DETAIL_TARGETS.map((k) => <Field key={k} label={k === "account_no" ? "Account # / MRN (to match, and fill)" : DETAIL_FIELD_LABEL[k]}><Combo value={map[k]} onChange={(v) => setMap({ ...map, [k]: v })} options={headerOpts} /></Field>)}
          </div>
          <div className="row mt8" style={{ gap: 18, flexWrap: "wrap" }}>
            <label className="check small"><input type="checkbox" checked={keepOther} onChange={(e) => setKeepOther(e.target.checked)} /> Also keep the other {others.length} column{others.length === 1 ? "" : "s"} on the claim (shown under Full claim details)</label>
            <label className="check small"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Replace values the claim already has (normally only empty fields are filled)</label>
          </div>
          {!map.claim_no && !map.account_no && <div className="alert warn mt8">Pick the claim # or account # column so the rows can be matched to claims.</div>}
          <div className="row mt16" style={{ gap: 10 }}>
            <button className="btn primary" disabled={!ready || !!busy} onClick={run}>{busy || "Fill the details"}</button>
            {!clientId && <span className="small muted">Pick the client.</span>}{clientId && !purpose && <span className="small muted">Pick why you are uploading it.</span>}
          </div>
        </>}
        {result && <div className="alert info mt16"><b>{fmtInt(result.updated)} claims filled</b> from {fmtInt(result.matched)} of {fmtInt(result.rows)} rows. {Object.entries(result.fields || {}).map(([k, n]) => `${DETAIL_FIELD_LABEL[k] || "other columns"}: ${fmtInt(n)}`).join(" · ")}
          {result.rows - result.matched > 0 && <> · <b>{fmtInt(result.rows - result.matched)} rows matched no claim</b> <button className="btn sm link" onClick={() => downloadText(toCSV(lastUnmatched, [{ key: "claim_no", label: "Claim #" }, { key: "account_no", label: "Account #" }, { key: "patient", label: "Patient" }]), "unmatched-rows.csv")}>Download them</button></>}
          {" "}<button className="btn sm link" onClick={() => go("claims", { clientId })}>See the claims</button></div>}
      </div>
      <div className="card tight">
        <div className="b small mb">Reports uploaded</div>
        <ErrorBox error={hist.error} />
        <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Client</th><th>File</th><th>Why</th><th className="r">Rows</th><th className="r">Matched</th><th className="r">Claims filled</th><th>Fields</th></tr></thead>
          <tbody>{(hist.data ? hist.data.rows : []).map((h) => (
            <tr key={h.id}><td className="small">{fmtWhen(h.created_at)}<div className="tiny muted">{h.user_name}</div></td><td className="small">{h.client_name}{h.location_name ? " · " + h.location_name : ""}</td><td className="small">{h.file_name}</td>
              <td className="small"><b>{h.purpose}</b>{h.note ? <div className="tiny muted">{h.note}</div> : null}</td><td className="num">{fmtInt(h.rows_read)}</td><td className="num">{fmtInt(h.rows_matched)}</td><td className="num">{fmtInt(h.claims_updated)}</td>
              <td className="tiny">{Object.entries(h.fields || {}).map(([k, n]) => `${DETAIL_FIELD_LABEL[k] || "other"} ${n}`).join(" · ")}</td></tr>))}
            {hist.data && !hist.data.rows.length && <tr><td colSpan={8}><Empty>No patient details reports yet.</Empty></td></tr>}</tbody></table></div>
      </div>
    </div>
  );
}
function InventoryView({ ctx, reload, go, params, me, initialTab }) {
  const [tab, setTab] = useState(initialTab || "upload");
  const [refresh, setRefresh] = useState(null);
  return (
    <div className="stack">
      <div><h1>Inventory & allocation</h1><div className="sub">From the client's file to every biller's day list: upload, check what changed, and hand the work out.</div></div>
      <div className="grid g4">{INV_TABS.map(([k, t, d]) => <button key={k} type="button" className={"card tight tabcard" + (tab === k ? " on" : "")} onClick={() => setTab(k)}><div className="tc-t">{t}</div><div className="small muted mt8">{d}</div></button>)}</div>
      {tab === "upload" ? <UploadWizard key={refresh ? refresh.id : "new"} ctx={ctx} reload={reload} go={go} params={params} me={me} folderLink="" refreshBatch={refresh} />
        : tab === "batches" ? <BatchesTable ctx={ctx} onRefresh={(b) => { setRefresh(b); setTab("upload"); }} />
        : tab === "details" ? <DetailsReport ctx={ctx} go={go} />
        : <AllocateView ctx={ctx} params={params} go={go} embedded />}
    </div>
  );
}
function UploadWizard({ ctx, reload, go, params, me, folderLink, refreshBatch }) {
  const [step, setStep] = useState(0);
  const [odOpen, setOdOpen] = useState(false);
  const [autoAlloc, setAutoAlloc] = useState(true);
  const [clientId, setClientId] = useState((refreshBatch && refreshBatch.client_id) || (params && params.clientId) || "");
  const [locId, setLocId] = useState((refreshBatch && refreshBatch.location_id) || "");
  const [locMode, setLocMode] = useState("pick");
  const [kind, setKind] = useState((refreshBatch && refreshBatch.kind) || "fresh");
  /* Refresh: fetch the same OneDrive file again and run it through as a new upload of the same client, location and kind. */
  const [refreshing, setRefreshing] = useState(!!(refreshBatch && refreshBatch.web_url));
  useEffect(() => {
    if (!refreshBatch || !refreshBatch.web_url) return;
    (async () => {
      try {
        let a = await msx.account(); if (!a) a = await msx.signIn();
        const it = await msItemFromLink(refreshBatch.web_url);
        const d = await msDownloadItem(driveIdOf(it), it.id);
        await onOneDriveFile({ bytes: d.bytes, name: d.info.name || refreshBatch.file_name, webUrl: d.info.webUrl || refreshBatch.web_url });
      } catch (e) { toast("Could not fetch the file again from OneDrive: " + msalMessage(e), "err"); }
      setRefreshing(false);
    })();
  }, []);
  const [file, setFile] = useState(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [table, setTable] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef();
  const client = ctx.clients.find((c) => c.id === clientId);
  const today = todayISO();
  const applySheet = (sheets, i) => { const t = tableFromSheet(sheets[i].rows); const m = autoMap(t.headers); setSheetIdx(i); setTable(t); setMapping(m); return m; };
  const pickSheet = (sheets, i) => { applySheet(sheets, i); };
  /* Columns recognised and the client already chosen: load at once. Otherwise ask where it goes (and show the columns if they were not recognised). */
  const afterPick = (m) => { const ok = !!(m.claim_no || (m.patient && m.dos)) && !(locMode === "file" && !m.location); setShowCols(!ok); if (ok && clientId) setAutoGo(true); else setStep(2); };
  const [showCols, setShowCols] = useState(false);
  const onFile = async (f) => {
    if (!f) return;
    setBusy(true);
    try {
      const buf = await f.arrayBuffer();
      const sheets = readWorkbook(buf, f.name);
      if (!sheets.length) throw new Error("No rows were found in this file.");
      setFile({ name: f.name, sheets, size: f.size });
      afterPick(applySheet(sheets, 0));
    } catch (e) { toast("Could not read the file: " + e.message, "err"); }
    setBusy(false);
  };
  const onOneDriveFile = async ({ bytes, name, webUrl }) => {
    setBusy(true);
    try {
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const sheets = readWorkbook(buf, name);
      if (!sheets.length) throw new Error("No rows were found in " + name + ".");
      setFile({ name, sheets, size: bytes.byteLength, source: "onedrive", webUrl });
      afterPick(applySheet(sheets, 0));
      setOdOpen(false);
    } catch (e) { toast("Could not read the file: " + e.message, "err"); }
    setBusy(false);
  };
  const loc = client ? client.locations.find((l) => l.id === locId) : null;
  const teamIds = loc && loc.team && loc.team.length ? loc.team : (client ? client.team || [] : []);
  const teamNames = ctx.users.filter((u) => u.active && teamIds.includes(u.id)).map((u) => u.name);
  const built = useMemo(() => (table ? buildClaims({ rows: table.rows, mapping, kind, today }) : null), [table, mapping, kind]);
  const [autoGo, setAutoGo] = useState(false);
  useEffect(() => { if (autoGo && built && file) { setAutoGo(false); load(); } }, [autoGo, built, file]);
  const backToStart = () => { setStep(0); setFile(null); setTable(null); setMapping({}); };
  const mappingOk = !!(mapping.claim_no || (mapping.patient && mapping.dos));
  const samples = (h) => { if (!h || !table) return ""; const vals = []; for (const r of table.rows) { const v = r[h]; if (v !== "" && v != null) vals.push(String(v).slice(0, 28)); if (vals.length >= 3) break; } return vals.join(" · "); };
  const load = async () => {
    if (!built) return;
    setBusy(true); setStep(4); setProgress(0);
    try {
      const groups = [];
      if (locMode === "file" && mapping.location) {
        const m = by(built.claims, (c) => (c.location || "").trim());
        for (const [name, list] of m) {
          let loc = null;
          if (name) {
            loc = client.locations.find((l) => l.name.toLowerCase() === name.toLowerCase());
            if (!loc) { const r = await rpc("locations.save", { client_id: client.id, name }); loc = r.location; }
          }
          groups.push({ loc, claims: list });
        }
      } else groups.push({ loc: client.locations.find((l) => l.id === locId) || null, claims: built.claims });
      const results = [];
      let done = 0;
      for (const g of groups) {
        const r = await uploadClaims({ client_id: client.id, location_id: g.loc ? g.loc.id : null, kind, file_name: file.name, source: file.source || "file", web_url: file.webUrl || "", claims: g.claims, summary: { ...summarizeClaims(g.claims), mapping, sheet: file.sheets[sheetIdx].name }, rows_read: locMode === "file" ? g.claims.length : table.rows.length, onProgress: (p) => setProgress((done + p) / groups.length) });
        const row = { ...r, location: g.loc ? g.loc.name : "(no location)", total: g.claims.length, assigned: null };
        const team = g.loc && g.loc.team && g.loc.team.length ? g.loc.team : (client.team || []);
        const wants = g.loc ? g.loc.auto_allocate !== false : client.auto_allocate !== false;
        if (autoAlloc && wants && team.length) {
          try { row.assigned = await autoAllocate({ ctx, client, loc: g.loc }); } catch (e) { row.assignError = e.message; }
        }
        results.push(row);
        done++;
      }
      setResult(results); setProgress(1);
      toast("Inventory loaded.");
      reload();
    } catch (e) { toast(e.message, "err"); setStep(3); }
    setBusy(false);
  };
  const resetAll = () => { setStep(0); setFile(null); setTable(null); setMapping({}); setResult(null); setProgress(null); };
  const downloadSample = (k) => {
    const rows = makeSampleRows({ kind: k, seed: k === "worked" ? 5 : 3, count: 120, today });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, `sample-${k}-inventory.xlsx`);
  };
  return (
    <div className="card">
      {step === 0 && refreshing && <Spinner label={"Fetching " + (refreshBatch.file_name || "the file") + " again from OneDrive…"} />}
      {step === 0 && !refreshing && (
        <div className="stack">
          <div className="card tight stack" style={{ borderColor: "var(--teal)", alignItems: "flex-start" }}>
            <div className="b">Open OneDrive</div>
            <div className="small muted">{msSupported() ? "Your OneDrive opens here. Click the inventory file and it is read on the spot." : `Microsoft sign in only works when the app is opened from ${MS_CFG.redirectUri}.`}</div>
            <button className="btn primary lg" disabled={!msSupported() || busy} onClick={() => setOdOpen(true)}>{busy ? "Reading…" : "Open OneDrive"}</button>
          </div>
          {/* Files from the computer are only for demo mode (no OneDrive there); live uploads come from OneDrive. */}
          {(DEMO || !msSupported()) && (
            <div className={"drop " + (over ? "over" : "")} onClick={() => inputRef.current && inputRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); onFile(e.dataTransfer.files[0]); }}>
              <div className="display" style={{ fontSize: 16, color: "var(--ink)" }}>{busy ? "Reading…" : "Demo: drop a file from this computer"}</div>
              <div className="small">Excel (.xlsx, .xls) or CSV. Header row is detected automatically.</div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.xlsm,.csv,.txt,.tsv" style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0])} />
            </div>
          )}
          <div className="small muted">You can pick the client and location now, or after the file is read.</div>
          <div className="grid g3">
            <ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} locId={locId} setLocId={(v) => { setLocId(v); if (v) setLocMode("pick"); }} />
            <Field label="Inventory kind">
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="fresh">Fresh inventory (never worked)</option>
                <option value="worked">Previously worked inventory</option>
              </select>
            </Field>
          </div>
          {!ctx.clients.filter((c) => c.active).length && <div className="alert warn">No clients yet. <button className="btn link sm" onClick={() => go("clients")}>Add the client and its locations</button> first, then come back here.</div>}
          {DEMO && <div className="row small muted">Need a file to try? <button className="btn link sm" onClick={() => downloadSample("fresh")}>Download sample fresh inventory</button><button className="btn link sm" onClick={() => downloadSample("worked")}>Download sample worked inventory</button></div>}
          {odOpen && <OneDrivePicker folderLink={(client && client.od && client.od.inventory) || folderLink} onClose={() => setOdOpen(false)} onPick={onOneDriveFile} />}
        </div>
      )}
      {step === 2 && table && (
        <div className="stack">
          <div className="row between">
            <div className="small"><b>{file.name}</b> · {fmtInt(table.rows.length)} rows{built ? <> · <b>{fmtInt(built.summary.included)} claims</b> found</> : null}</div>
            {file.sheets.length > 1 && <Field label="Sheet"><select className="select sm" value={sheetIdx} onChange={(e) => pickSheet(file.sheets, +e.target.value)}>{file.sheets.map((s, i) => <option key={i} value={i}>{s.name} ({fmtInt(s.rows.length)} rows)</option>)}</select></Field>}
          </div>
          <div className="grid g3">
            <ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} locId={locId} setLocId={(v) => { setLocId(v); if (v) setLocMode("pick"); }} />
            <Field label="Inventory kind">
              <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="fresh">Fresh inventory (never worked)</option>
                <option value="worked">Previously worked inventory</option>
              </select>
            </Field>
          </div>
          {client && client.locations.length > 0 && (
            <label className="check small"><input type="checkbox" checked={locMode === "file"} onChange={(e) => { setLocMode(e.target.checked ? "file" : "pick"); if (e.target.checked) setLocId(""); }} /> The file has a Location column: split it across this client's locations automatically (new names are created)</label>
          )}
          {client && locMode !== "file" && (
            <div className="card tight row between">
              <div className="small">{teamNames.length ? <><b>Billers for {loc ? loc.name : client.name}:</b> {teamNames.join(", ")}. The claims are handed to them as soon as they load.</> : <><b>No billers mapped to {loc ? loc.name : client.name} yet.</b> <button className="btn link sm" onClick={() => go("clients", { client_id: client.id, focus: "people" })}>Add people on the client's card</button>, or allocate by hand afterwards.</>}</div>
              <label className="check small"><input type="checkbox" checked={autoAlloc && !!teamNames.length} disabled={!teamNames.length} onChange={(e) => setAutoAlloc(e.target.checked)} /> Allocate after loading</label>
            </div>
          )}
          {!mappingOk && <div className="alert warn">The claim column was not recognised. Point at the <b>Claim #</b> column below (or Patient name and Date of service) so claims can be told apart.</div>}
          {mappingOk && !showCols && <div className="small muted">Columns were recognised by name. <button className="btn link sm" onClick={() => setShowCols(true)}>Check the columns</button></div>}
          {showCols && (
            <div className="table-wrap"><table className="t"><thead><tr><th>Brahmastra field</th><th>Column in your file</th><th>Sample values</th></tr></thead>
              <tbody>{FIELDS.filter((f) => !f.worked || kind === "worked").map((f) => (
                <tr key={f.key} className={f.key === "balance" && !mapping.balance ? "hl" : ""}>
                  <td><b>{f.label}</b>{f.hint && <div className="tiny muted">{f.hint}</div>}</td>
                  <td><select className="select sm" value={mapping[f.key] || ""} onChange={(e) => { const m = { ...mapping }; if (e.target.value) m[f.key] = e.target.value; else delete m[f.key]; setMapping(m); }}>
                    <option value="">(not in file)</option>{table.headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></td>
                  <td className="small muted">{samples(mapping[f.key])}</td>
                </tr>))}</tbody></table></div>
          )}
          {!mapping.balance && <div className="alert warn">No Balance column: every claim will be treated as a small balance and land in the Low tier.</div>}
          {locMode === "file" && !mapping.location && <div className="alert warn">You chose to split by the file's Location column, but none is mapped. Map it, or pick one location.</div>}
          <div className="row between"><button className="btn" onClick={backToStart}>Back</button><button className="btn primary" disabled={!client || !mappingOk || (locMode === "file" && !mapping.location) || busy} onClick={() => load()}>{busy ? "Loading…" : !client ? "Pick the client to load" : `Load ${built ? fmtInt(built.summary.included) : ""} claims`}</button></div>
        </div>
      )}
      {step === 4 && (
        <div className="stack">
          {progress != null && progress < 1 && <div><div className="bar"><i style={{ width: Math.round(progress * 100) + "%" }} /></div><div className="small muted mt8"><span className="spin" /> Loading claims… {Math.round(progress * 100)}%</div></div>}
          {result && (
            <>
              <div className="alert info"><b>Done.</b> {result.map((r) => `${r.location}: ${fmtInt(r.inserted)} new, ${fmtInt(r.updated)} refreshed, ${fmtInt(r.reopened)} reopened, ${fmtInt(r.closed)} closed, ${fmtInt(r.excluded)} excluded`).join(" · ")}</div>
              {result.map((r, i) => r.assigned ? <div key={i} className="alert info"><b>{r.location}: {fmtInt(r.assigned.applied)} claims allocated</b>{r.assigned.applied ? " · " + r.assigned.perUser.filter((u) => u.count).map((u) => `${u.name} ${fmtInt(u.count)} (${fmtMoney(u.amt)})`).join(", ") : " · " + (r.assigned.reason || "nothing to allocate")}. Change it on Allocate or Claims if needed.</div> : r.assignError ? <div key={i} className="alert warn">{r.location}: loaded, but automatic allocation failed: {r.assignError}</div> : <div key={i} className="small muted">{r.location}: not allocated automatically (no billers mapped, or allocation switched off). Use Allocate when ready.</div>)}
              <div className="row"><button className="btn primary" onClick={() => go("allocate", { clientId })}>Open Allocate</button><button className="btn" onClick={() => go("claims", { clientId })}>Browse claims</button><button className="btn" onClick={resetAll}>Upload another file</button></div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
function ReviewStep({ built, kind, onBack, onLoad, busy }) {
  const s = built.summary;
  const exclRows = Object.entries(s.excluded || {});
  const preview = built.claims.filter((c) => !c.exclude_reason).slice(0, 40);
  return (
    <div className="stack">
      <div className="grid g4">
        <Kpi label="Claims to load" value={fmtInt(s.included)} sub={`${fmtInt(s.rowsRead)} rows read · ${fmtInt(s.linesRolled)} service lines rolled up`} tone="accent" />
        <Kpi label="Workable balance" value={fmtMoney(s.amount)} sub={`average ${fmtMoney(s.cut.avg)} · High tier above ${fmtMoney(s.cut.high)}`} />
        <Kpi label="Excluded" value={fmtInt(exclRows.reduce((n, [, v]) => n + v.n, 0))} sub={exclRows.map(([k, v]) => `${k}: ${v.n}`).join(" · ") || "nothing excluded"} />
        <Kpi label={kind === "worked" ? "With a date worked" : "Patients with 3+ claims"} value={kind === "worked" ? fmtInt(built.claims.filter((c) => c.last_worked_on).length) : fmtInt(s.patientsWith3Plus)} sub={kind === "worked" ? "follow-up dates set from it" : "batching opportunity"} />
      </div>
      <div className="grid g3">
        <div className="card tight"><div className="b small mb">Value tiers</div><Bars rows={s.tiers} labelOf={(r) => r.key} valueOf={(r) => r.amt} subOf={(r) => plural(r.n, "claim")} /></div>
        <div className="card tight"><div className="b small mb">Aging</div><Bars rows={s.buckets} labelOf={(r) => r.key} valueOf={(r) => r.amt} subOf={(r) => plural(r.n, "claim")} /></div>
        <div className="card tight"><div className="b small mb">Status read from the file</div><Bars rows={s.classes} labelOf={(r) => STATUS_LABEL[r.key] || r.key} valueOf={(r) => r.amt} subOf={(r) => plural(r.n, "claim")} /></div>
      </div>
      {(s.footer > 0 || s.blank > 0) && <div className="small muted">Skipped {s.footer} total/footer rows and {s.blank} rows with no claim, patient or date.</div>}
      <div><div className="b small mb">Preview: top of the work order (highest priority first)</div>
        <div className="table-wrap" style={{ maxHeight: 360 }}><table className="t"><thead><tr><th>Claim #</th><th>Patient</th><th>Payer</th><th>DOS</th><th className="r">Age</th><th className="r">Balance</th><th>Tier</th><th>Status</th><th>Why this order</th></tr></thead>
          <tbody>{preview.map((c, i) => <tr key={i}><td className="mono small">{c.claim_no || "–"}</td><td>{c.patient}</td><td>{c.payer}</td><td className="small">{fmtDate(c.dos)}</td><td className="num">{c.age_days ?? "–"}</td><td className="num">{fmtMoney(c.balance)}</td><td><TierBadge tier={c.tier} /></td><td><ClassBadge cls={c.status_class} /></td><td className="small muted">{c.priority_reason}</td></tr>)}</tbody></table></div></div>
      <div className="row between"><button className="btn" onClick={onBack} disabled={busy}>Back</button><button className="btn primary" onClick={onLoad} disabled={busy || !s.included}>{busy ? "Loading…" : `Load ${fmtInt(s.included)} claims`}</button></div>
    </div>
  );
}
function BatchesTable({ ctx, onRefresh }) {
  const [clientId, setClientId] = useState("");
  const q = useRpc("inventory.batches", { client_id: clientId || undefined }, [clientId]);
  const [undo, setUndo] = useState(null);
  const [busy, setBusy] = useState(false);
  const doUndo = async () => { setBusy(true); try { const r = await rpc("inventory.undoBatch", { batch_id: undo.id }); toast(`Removed ${fmtInt(r.removed)} untouched claims added by this upload.`); setUndo(null); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const [dup, setDup] = useState(null);
  const checkDup = async () => { setBusy(true); try { const r = await rpc("inventory.dedupe", { client_id: clientId, dry_run: true }); setDup(r); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const doDedupe = async () => { setBusy(true); try { const r = await rpc("inventory.dedupe", { client_id: clientId }); toast(r.duplicates ? `Merged ${fmtInt(r.duplicates)} duplicate claims into ${fmtInt(r.groups)}.` : "No duplicates found."); setDup(null); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  return (
    <div className="card stack">
      <div className="row between"><h2>Upload history</h2><div className="row"><div style={{ minWidth: 240 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} allowAll /></div><button className="btn sm" disabled={!clientId || busy} title="Find claims loaded twice (same claim number written differently, or same patient and date of service) and merge them" onClick={checkDup}>Merge duplicate claims</button></div></div>
      {dup && (
        <Confirm title={dup.duplicates ? `Merge ${fmtInt(dup.duplicates)} duplicate claims?` : "No duplicates found"} text={dup.duplicates ? `${fmtInt(dup.duplicates)} claims are copies of ${fmtInt(dup.groups)} claims already on file (same claim number written differently, or same patient and date of service). Each copy's notes, work history and biller move onto the original, and the copy is removed.` : "Every claim of this client is unique."} confirmLabel={dup.duplicates ? "Merge" : "OK"} onYes={dup.duplicates ? doDedupe : () => setDup(null)} onNo={() => setDup(null)} busy={busy} />
      )}
      <ErrorBox error={q.error} />
      <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Client · location</th><th>Kind</th><th>File</th><th>By</th><th className="r">Rows</th><th className="r">New</th><th className="r">Refreshed</th><th className="r">Reopened</th><th className="r">Closed</th><th className="r">Excluded</th><th></th></tr></thead>
        <tbody>{(q.data ? q.data.batches : []).map((b) => <tr key={b.id} style={b.undone_at ? { opacity: .5 } : undefined}><td className="small">{fmtWhen(b.uploaded_at)}</td><td>{b.client_name || (ctx.clients.find((c) => c.id === b.client_id) || {}).name}{b.location_name ? <span className="muted"> · {b.location_name}</span> : ""}</td><td>{b.kind === "worked" ? <span className="badge purple">worked</span> : <span className="badge green">fresh</span>}</td><td className="small">{b.web_url ? <a href={b.web_url} target="_blank" rel="noopener" title="Open in OneDrive">{b.file_name}</a> : b.file_name}{b.source === "onedrive" && <span className="badge blue" style={{ marginLeft: 6 }}>OneDrive</span>}</td><td className="small">{b.uploaded_by_name}</td><td className="num">{fmtInt(b.rows_read)}</td><td className="num">{fmtInt(b.inserted)}</td><td className="num">{fmtInt(b.updated)}</td><td className="num">{fmtInt(b.reopened)}</td><td className="num">{fmtInt(b.closed)}</td><td className="num">{fmtInt(b.excluded)}</td><td style={{ whiteSpace: "nowrap" }}>{b.undone_at ? <span className="tiny muted">undone</span> : <>{b.source === "onedrive" && b.web_url && msSupported() && <button className="btn sm" title="Read the same OneDrive file again and refresh the claims from it" onClick={() => onRefresh(b)}>Refresh</button>} <button className="btn sm link" onClick={() => setUndo(b)}>Undo</button></>}</td></tr>)}
          {q.data && !q.data.batches.length && <tr><td colSpan={12} className="muted">No uploads yet.</td></tr>}</tbody></table></div>
      {undo && <Confirm title="Undo this upload?" text="Claims this upload added that nobody has worked yet will be deleted. Claims it refreshed keep their refreshed values." confirmLabel="Undo upload" danger onYes={doUndo} onNo={() => setUndo(null)} busy={busy} />}
    </div>
  );
}

/* ---------- claims explorer ---------- */
const CLAIM_COLS = [
  { key: "claim_no", label: "Claim #" }, { key: "account_no", label: "Account #" }, { key: "patient", label: "Patient" }, { key: "payer", label: "Payer" }, { key: "dos", label: "DOS" }, { key: "cpt", label: "CPT" }, { key: "provider", label: "Provider" },
  { key: "balance", label: "Balance" }, { key: "billed", label: "Billed" }, { key: "age_days", label: "Age (days)" }, { key: "bucket", label: "Bucket" }, { key: "tier", label: "Tier" }, { key: "status_class", label: "Status class", get: (r) => STATUS_LABEL[r.status_class] || r.status_class },
  { key: "file_status", label: "File status" }, { key: "file_sub_status", label: "File sub status" }, { key: "inventory_kind", label: "Inventory" }, { key: "worked_before", label: "Worked before", get: (r) => (r.worked_before ? "Yes" : "No") }, { key: "last_worked_on", label: "Last worked on" }, { key: "follow_up_on", label: "Follow-up on" },
  { key: "priority", label: "Priority" }, { key: "priority_reason", label: "Priority reason" }, { key: "state", label: "State" }, { key: "assigned_name", label: "Assigned to" },
  { key: "last_status_code", label: "SAAG status" }, { key: "last_sub_status", label: "SAAG sub-status" }, { key: "last_action_code", label: "SAAG action" }, { key: "last_bucket", label: "Bucket" }, { key: "last_effective", label: "Effective matrix" },
  { key: "last_note", label: "Last note (one cell)" }, { key: "location_name", label: "Location" },
];
/* One small button; the rules live in a dialog so they do not crowd the screen. */
function AllocationLogicButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn sm link" onClick={() => setOpen(true)} title="How claims are ordered and handed out">See allocation logic</button>
      {open && (
        <Modal title="How allocation works" sub="Every claim gets a priority score; billers get the highest scores first, with a patient's or payer's claims kept together." onClose={() => setOpen(false)}>
          <div className="stack">
            <div><div className="b small mb">1. Priority score (higher works first)</div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                <li><b>Status</b>: rejected 100 · denied 90 · partial payment 75 · secondary 65 · awaiting payer 50 · other 40 · patient responsibility 20 · paid 0.</li>
                <li><b>TFL / AFL deadline</b> (when saved for the insurance on the TFL / AFL page): days left before the deadline. 0–7 days +80 · 8–15 +65 · 16–30 +50 · 31–60 +25, more than 60 days 0; past the TFL +5 (needs proof of timely filing), past the AFL 0. The TFL counts from DOS while the payer has not accepted the claim (rejected, no response, secondary, other); the AFL counts from the denial / EOB date the biller enters, for denied and underpaid claims.</li>
                <li><b>Age since date of service</b>, only when no TFL / AFL deadline applies: 75–90 days +45 (near timely filing) · 91–120 +35 · 121–360 +30 · 361+ +25 · 61–74 +20 · 31–60 +10.</li>
                <li><b>Value tier</b>: High +30 · Medium +15 · Low (under $100) 0, and a Low claim's whole score is halved. High = above the client's average balance.</li>
                <li><b>Balance</b>: up to +25 more, growing with the amount.</li>
                <li><b>Follow-up</b>: due today +15 · overdue 15+ days +25. Escalated +10. Each skip −5.</li>
              </ul>
              <div className="tiny muted mt8">The claim's own "Priority reason" column shows which of these applied to it.</div></div>
            <div><div className="b small mb">2. Handing out (smart strategy, the default)</div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>Claims are taken in score order, highest first.</li>
                <li>A patient with 2+ claims goes to one biller as a batch; other claims are grouped by payer, so one biller calls one payer.</li>
                <li>Each claim goes to the biller with the most capacity left (claims per day on the Team screen); ties go to whoever has fewer so far.</li>
                <li>Automatic allocation after an upload uses the billers mapped on the Locations tab and splits evenly between them.</li>
                <li>Claims already on someone's desk are never moved automatically; a team lead can move them on Allocate or Claims.</li>
              </ul></div>
            <div className="small muted">Other strategies on the Allocate screen: by patient, by payer, round robin, or even dollars.</div>
          </div>
        </Modal>
      )}
    </>
  );
}
/* The latest entry on a claim: SAAG status › sub-status, action, bucket and the comment. */
function SaagCell({ r }) {
  if (!r.last_status_code && !r.last_note) return <span className="muted">–</span>;
  return <div style={{ maxWidth: 300 }}>{r.last_status_code ? <b>{r.last_status_code}{r.last_sub_status ? " › " + r.last_sub_status : ""}</b> : null}
    {r.last_action_code || r.last_bucket ? <div className="tiny muted">{[r.last_action_code, r.last_bucket].filter(Boolean).join(" · ")}</div> : null}
    {r.last_note ? <div className="tiny saag-note" title={r.last_note}>{r.last_note}</div> : null}</div>;
}
function ClaimsView({ ctx, params, me, initialTab }) {
  const p = params || {};
  const [tab, setTab] = useState(initialTab === "entries" || p.tab === "entries" ? "entries" : "claims");
  const [f, setF] = useState({ client_id: p.clientId || "", location_id: p.locationId || "", state: p.state != null ? p.state : (p.follow_up_due || p.overdue || p.assigned_to || p.escalated ? "" : "workable"), tier: p.tier || "", bucket: p.bucket || "", status_class: p.status_class || "", inventory_kind: p.inventory_kind || "", assigned_to: p.assigned_to || "", q: p.payer || "", provider: "", cpt: "", min_balance: "", max_balance: "", saag_status: p.saag_status || "", saag_bucket: p.saag_bucket || "", follow_up_due: !!p.follow_up_due, overdue: !!p.overdue, escalated: !!p.escalated, min_age: p.min_age || "", stage: INV_STAGES.some(([k]) => k === p.stage) ? p.stage : "", sort: p.sort || "priority", dir: p.dir || "desc", page: 1, page_size: 50 });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v, page: k === "page" ? v : 1 }));
  const payload = useMemo(() => { const o = {}; for (const k in f) if (f[k] !== "" && f[k] !== false) o[k] = f[k]; return o; }, [f]);
  const q = useRpc("claims.list", payload, [JSON.stringify(payload)]);
  const [sel, setSel] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [bulkUser, setBulkUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [prio, setPrio] = useState(null);
  const [prioLog, setPrioLog] = useState(false);
  const rows = q.data ? q.data.rows : [];
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const bulk = async (label, fn) => {
    if (!sel.size) return;
    setBusy(true);
    try { const r = await fn([...sel]); toast(`${label}: ${fmtInt(r.changed || r.applied || 0)} claims.`); setSel(new Set()); q.reload(); } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const sortBy = (k) => { if (f.sort === k) set("dir", f.dir === "asc" ? "desc" : "asc"); else setF((x) => ({ ...x, sort: k, dir: k === "patient" || k === "payer" ? "asc" : "desc", page: 1 })); };
  const th = (k, label, cls) => <th key={k} className={"sort " + (cls || "")} onClick={() => sortBy(k)}>{label}{f.sort === k ? (f.dir === "asc" ? " ▲" : " ▼") : ""}</th>;
  const exportCSV = async () => {
    setBusy(true);
    try {
      const all = [];
      for (let page = 1; page <= 20; page++) { const r = await rpc("claims.list", { ...payload, page, page_size: 500 }); all.push(...r.rows); if (all.length >= r.total || !r.rows.length) break; }
      downloadText(toCSV(all, CLAIM_COLS), `brahmastra-claims-${todayISO()}.csv`);
    } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  // the CSV the team keeps: the Production Conso layout, one row per claim with its last entry
  const exportProduction = async () => {
    setBusy(true);
    try { const r = await rpc("reports.claimsProduction", payload); downloadText(arrayCSV(r.header, r.rows), `Production - claims - ${todayISO()}.csv`); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const users = ctx.users.filter((u) => u.active);
  return (
    <div className="stack">
      <div className="row between"><div><h1>Claims</h1><div className="sub">{deskOf(me, null) ? "The claims billers and AR team leads sent to " + DESK[deskOf(me, null)].tab + " through their SAAG action." : tab === "entries" ? "Every entry the team wrote, with the claim it belongs to, for any dates. The CSV is the Production layout." : "Every claim on file, with filters, bulk actions and export. The CSV is the Production layout the team keeps."}</div></div>
        <div className="row" style={{ gap: 8 }}>{!deskOf(me, null) && <><AllocationLogicButton /><button className="btn" onClick={() => setPrioLog(true)} title="Every priority change with its reason">Priority changes</button></>}
          {tab === "claims" && <><button className="btn" onClick={exportProduction} disabled={busy || !rows.length} title="One row per claim with its last entry, in the Production Conso columns">Download CSV</button><button className="btn link sm" onClick={exportCSV} disabled={busy || !rows.length} title="Brahmastra's own columns: priority, tier, state, assigned to, the SAAG fields">Brahmastra columns</button></>}</div></div>
      {!deskOf(me, null) && <div className="seg2" style={{ alignSelf: "flex-start" }}>{[["claims", "Claims"], ["entries", "Entries"]].map(([k, l]) => <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>}
      {tab === "entries" && !deskOf(me, null) ? <ReportsView ctx={ctx} embedded /> : <>
      <div className="card tight">
        <div className="grid g5">
          <ClientPicker ctx={ctx} clientId={f.client_id} setClientId={(v) => setF((x) => ({ ...x, client_id: v, location_id: "", page: 1 }))} locId={f.location_id} setLocId={(v) => set("location_id", v)} allowAll />
          <Field label="State"><Combo value={f.state} onChange={(v) => set("state", v)} placeholder="Any state" options={[{ id: "workable", label: "Workable (open, assigned, in progress, worked)" }, { id: "", label: "Any state" }, ...Object.keys(STATE_META).map((k) => ({ id: k, label: STATE_META[k][1] }))]} /></Field>
          <Field label="Assigned to"><Combo value={f.assigned_to} onChange={(v) => set("assigned_to", v)} placeholder="Anyone" options={[{ id: "", label: "Anyone" }, { id: "__none", label: "Nobody (unassigned)" }, ...users.map((u) => ({ id: u.id, label: u.name, sub: u.designation || undefined }))]} /></Field>
          <Field label="Search"><SuggestCombo field="q" placeholder="claim #, patient, account, payer" value={f.q} onChange={(v) => set("q", v)} extra={{ client_id: f.client_id || undefined, location_id: f.location_id || undefined }} /></Field>
        </div>
        <div className="row mt8" style={{ gap: 6 }}>
          <Combo sm width={120} value={f.tier} onChange={(v) => set("tier", v)} placeholder="Any tier" options={[{ id: "", label: "Any tier" }, ...["High", "Medium", "Low"].map((t) => ({ id: t, label: t + " tier" }))]} />
          <Combo sm width={130} value={f.bucket} onChange={(v) => set("bucket", v)} placeholder="Any age" options={[{ id: "", label: "Any age" }, ...BUCKET_ORDER.map((b) => ({ id: b, label: b + " days" }))]} />
          <Combo sm width={140} value={f.status_class} onChange={(v) => set("status_class", v)} placeholder="Any status" options={[{ id: "", label: "Any status" }, ...STATUS_ORDER.map((k) => ({ id: k, label: STATUS_LABEL[k] }))]} />
          <Combo sm width={160} value={f.inventory_kind} onChange={(v) => set("inventory_kind", v)} placeholder="Fresh and worked" options={[{ id: "", label: "Fresh and worked" }, { id: "fresh", label: "Fresh inventory" }, { id: "worked", label: "Previously worked" }]} />
          <SuggestCombo sm width={150} field="provider" placeholder="Any provider" value={f.provider} onChange={(v) => set("provider", v)} extra={{ client_id: f.client_id || undefined }} />
          <SuggestCombo sm width={120} field="cpt" placeholder="Any CPT" value={f.cpt} onChange={(v) => set("cpt", v)} extra={{ client_id: f.client_id || undefined }} />
          <input className="input sm" style={{ width: 84 }} type="number" placeholder="min $" value={f.min_balance} onChange={(e) => set("min_balance", e.target.value)} />
          <input className="input sm" style={{ width: 84 }} type="number" placeholder="max $" value={f.max_balance} onChange={(e) => set("max_balance", e.target.value)} />
          <Combo sm width={180} value={f.saag_status} onChange={(v) => set("saag_status", v)} placeholder="Any SAAG status" options={[{ id: "", label: "Any SAAG status" }, ...SAAG.statuses.map((x) => ({ id: x, label: x }))]} />
          <Combo sm width={140} value={f.saag_bucket} onChange={(v) => set("saag_bucket", v)} placeholder="Any bucket" options={[{ id: "", label: "Any bucket" }, ...BUCKETS4.map((b) => ({ id: b, label: b }))]} />
          <Combo sm width={200} value={f.handoff_status || ""} onChange={(v) => setF((x) => ({ ...x, handoff_status: v, state: v ? "" : x.state, page: 1 }))} placeholder="Any posting / submission" options={[{ id: "", label: "Any posting / submission" }, ...Object.entries(HANDOFF_META).map(([k, m]) => ({ id: k, label: m[1] }))]} />
          <label className="check small"><input type="checkbox" checked={f.follow_up_due} onChange={(e) => set("follow_up_due", e.target.checked)} /> Follow-up due</label>
          <label className="check small" style={{ color: "var(--red-ink)" }}><input type="checkbox" checked={f.overdue} onChange={(e) => set("overdue", e.target.checked)} /> Overdue, no new entry</label>
          {f.min_age ? <label className="check small"><input type="checkbox" checked onChange={() => set("min_age", "")} /> Over {f.min_age - 1} days old</label> : null}
          {f.stage ? <label className="check small"><input type="checkbox" checked onChange={() => set("stage", "")} /> {(INV_STAGES.find(([k]) => k === f.stage) || [])[1]}</label> : null}
          <label className="check small"><input type="checkbox" checked={f.escalated} onChange={(e) => set("escalated", e.target.checked)} /> Escalated</label>
          <span style={{ flex: 1 }} />
          {q.data && <span className="small muted">{fmtInt(q.data.total)} claims · {fmtMoney(q.data.amount)}</span>}
        </div>
      </div>
      {sel.size > 0 && (
        <div className="card tight row" style={{ background: "var(--soft)" }}>
          <b>{sel.size} selected</b>
          <Combo sm width={220} value={bulkUser} onChange={setBulkUser} placeholder="Assign to…" options={users.map((u) => ({ id: u.id, label: u.name, sub: u.designation || undefined }))} />
          <button className="btn sm primary" disabled={!bulkUser || busy} onClick={() => bulk("Assigned", (ids) => rpc("alloc.reassign", { ids, user_id: bulkUser }))}>Assign</button>
          <button className="btn sm" disabled={busy} onClick={() => bulk("Unassigned", (ids) => rpc("alloc.unassign", { ids }))}>Unassign</button>
          <button className="btn sm" disabled={busy} onClick={() => setPrio({ ids: [...sel], rows: rows.filter((r) => sel.has(r.id)) })}>Change priority</button>
          <button className="btn sm" disabled={busy} onClick={() => bulk("Reopened", (ids) => rpc("claims.setState", { ids, state: "open" }))}>Reopen</button>
          <button className="btn sm" disabled={busy} onClick={() => bulk("Excluded", (ids) => rpc("claims.setState", { ids, state: "excluded" }))}>Exclude</button>
          <button className="btn sm danger" disabled={busy} onClick={() => bulk("Closed", (ids) => rpc("claims.setState", { ids, state: "closed" }))}>Close</button>
          <button className="btn sm link" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      )}
      <div className="card tight">
        <ErrorBox error={q.error} />
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap"><table className="t"><thead><tr>
          <th><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
          {th("priority", "Priority", "r")}{th("claim_no", "Claim #")}{th("patient", "Patient")}{th("payer", "Payer")}{th("dos", "DOS")}{th("age_days", "Age", "r")}{th("balance", "Balance", "r")}{th("tier", "Tier")}{th("status_class", "Status")}{th("inventory_kind", "Kind")}{th("state", "State")}{th("assigned", "Assigned")}{th("last_status_code", "Last SAAG & comment")}{th("follow_up_on", "Follow-up")}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="click" onClick={() => setOpen(r.id)}>
              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
              <td className="num" title={r.priority_reason + "\nClick to change the priority"} onClick={(e) => { e.stopPropagation(); setPrio({ ids: [r.id], rows: [r] }); }} style={{ cursor: "pointer", whiteSpace: "nowrap" }}>{r.priority}{PRIORITY_LEVELS_UI[r.priority_set] ? <div><span className={"badge " + (r.priority_set === "low" ? "gray" : "purple")} title={r.priority_set_label}>{PRIORITY_LEVELS_UI[r.priority_set].short}</span></div> : <div className="tiny muted">✎ change</div>}</td><td className="mono small">{r.claim_no || "–"}</td><td>{r.patient}<div className="tiny muted">{r.account_no}</div></td><td>{r.payer}</td><td className="small">{fmtDate(r.dos)}</td><td className="num">{r.age_days ?? "–"}</td><td className="num">{fmtMoney(r.balance)}</td>
              <td><TierBadge tier={r.tier} /></td><td><ClassBadge cls={r.status_class} /></td><td><KindBadge claim={r} /></td><td><StateBadge state={r.state} />{r.escalated ? <span className="badge red" style={{ marginLeft: 4 }}>esc</span> : null}{r.skips ? <span className="badge amber" style={{ marginLeft: 4 }}>skipped ×{r.skips}</span> : null}<HandoffBadge status={r.handoff_status} /></td><td className="small">{r.assigned_name || "–"}</td><td className="small"><SaagCell r={r} /></td><td className="small">{r.follow_up_on ? fmtDate(r.follow_up_on) : "–"}</td>
            </tr>))}
            {q.data && !rows.length && <tr><td colSpan={15}><Empty>No claims match these filters.</Empty></td></tr>}</tbody></table></div>
        {q.data && <div className="mt8"><Pager page={q.data.page} pageSize={q.data.page_size} total={q.data.total} onPage={(pg) => set("page", pg)} /></div>}
      </div>
      {open && <ClaimDrawer id={open} ctx={ctx} me={me} onClose={() => setOpen(null)} onChanged={() => q.reload()} />}
      {prio && <PriorityModal ids={prio.ids} rows={prio.rows} onClose={() => setPrio(null)} onDone={() => { setPrio(null); setSel(new Set()); q.reload(); }} />}
      {prioLog && <PriorityLogModal onClose={() => setPrioLog(false)} onOpen={(id) => { setPrioLog(false); setOpen(id); }} />}
    </>}
    </div>
  );
}
/* A team lead changes the priority of one or more claims, always with the reason. */
function PriorityModal({ ids, rows, onClose, onDone }) {
  const one = rows.length === 1 ? rows[0] : null;
  const [level, setLevel] = useState(one && one.priority_set ? one.priority_set : "top");
  const [category, setCategory] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const ok = category && comment.trim().length >= 8;
  const base = (r) => (r.priority_set ? null : r.priority);
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await rpc("claims.setPriority", { ids, level, category, comment }); toast(`Priority changed on ${fmtInt(r.changed)} claim${r.changed === 1 ? "" : "s"}.`); onDone(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const LEVELS = [["top", "⇈ Top: work first", "goes to the top of the biller's list and of the next allocation"], ["high", "↑ Raise", "ahead of similar claims"], ["low", "↓ Lower", "behind other claims until you change it back"], ["", "⟲ Automatic", "back to the score from age, value and status"]];
  return (
    <Modal title={"Change priority · " + (one ? (one.claim_no || one.patient || "claim") : ids.length + " claims")} sub={one ? [one.patient, one.payer, "score now " + one.priority + (one.priority_set_label ? " (" + one.priority_set_label + ")" : "")].filter(Boolean).join(" · ") : "The reason is saved on each claim."} onClose={onClose} narrow
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" onClick={go} disabled={busy || !ok}>{busy ? "Saving…" : "Save priority"}</button></>}>
      <div className="stack">
        <div className="field"><span>New priority</span>
          <div className="stack mt8" style={{ gap: 6 }}>{LEVELS.map(([k, l, d]) => (
            <label key={k || "auto"} className="check" style={{ alignItems: "flex-start" }}><input type="radio" name="prio-level" checked={level === k} onChange={() => setLevel(k)} /> <span><b>{l}</b> <span className="tiny muted">· {d}{one && base(one) != null && k ? " (score " + applyLevelUI(one.priority, k) + ")" : ""}</span></span></label>))}</div></div>
        <Field label="Why are you changing it?"><Combo value={category} onChange={setCategory} placeholder="Pick the reason…" options={PRIORITY_WHY.map((x) => ({ id: x, label: x }))} /></Field>
        <Field label="Comment"><textarea className="textarea" style={{ minHeight: 70 }} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Client escalated these on today's call; TFL ends next week for this payer." /></Field>
        <div className="alert info" style={{ fontSize: 12.5 }}><b>Why we ask:</b> every change and its reason is kept on the claim's history and in <b>Priority changes</b>. Reviewing them shows what the automatic score misses (a payer, a client request, deadlines), so the allocation rules can be improved and fewer claims need moving by hand.</div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}
/* All priority changes with their reasons, grouped by reason, to review what the automatic allocation should learn. */
function PriorityLogModal({ onClose, onOpen }) {
  const [days, setDays] = useState(30);
  const q = useRpc("claims.priorityLog", { days }, [days]);
  const sort = useTableSort("at", "desc");
  const rows = sort.sortRows(q.data ? q.data.rows : []);
  const cats = q.data ? q.data.categories : [];
  const exportCSV = () => downloadText(toCSV(rows, [{ key: "at", label: "When", get: (r) => new Date(r.at).toLocaleString() }, { key: "user_name", label: "Changed by" }, { key: "client_name", label: "Client" }, { key: "claim_no", label: "Claim #" }, { key: "patient", label: "Patient" }, { key: "payer", label: "Payer" }, { key: "balance", label: "Balance" }, { key: "age_days", label: "Age" }, { key: "text", label: "New priority" }, { key: "category", label: "Why" }, { key: "comment", label: "Comment" }, { key: "from", label: "Score before" }, { key: "to", label: "Score after" }]), `brahmastra-priority-changes-${todayISO()}.csv`);
  return (
    <Modal title="Priority changes" sub="Every claim a team lead moved up or down, and why. The most common reasons are what the automatic allocation should start doing by itself." onClose={onClose}
      footer={<><button className="btn" onClick={exportCSV} disabled={!rows.length}>Download CSV</button><button className="btn primary" onClick={onClose}>Close</button></>}>
      <div className="stack">
        <div className="pill-list">{[7, 30, 90, 365].map((d) => <button key={d} className={"chip " + (days === d ? "on" : "")} onClick={() => setDays(d)}>Last {d} days</button>)}</div>
        <ErrorBox error={q.error} />
        {q.loading && !q.data && <Spinner />}
        {cats.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Reason</th><th className="r">Claims</th><th className="r">Top</th><th className="r">Raised</th><th className="r">Lowered</th><th className="r">Back to auto</th><th className="r">Balance</th></tr></thead>
          <tbody>{cats.map((c) => <tr key={c.category}><td className="b small">{c.category}</td><td className="num">{fmtInt(c.n)}</td><td className="num">{c.top || ""}</td><td className="num">{c.high || ""}</td><td className="num">{c.low || ""}</td><td className="num">{c.auto || ""}</td><td className="num">{fmtMoney(c.balance)}</td></tr>)}</tbody></table></div>}
        <div className="table-wrap"><table className="t"><thead><tr>{sort.Th("at", "When")}{sort.Th("user_name", "By")}{sort.Th("claim_no", "Claim")}{sort.Th("payer", "Payer")}{sort.Th("balance", "Balance", "r")}{sort.Th("text", "Priority")}{sort.Th("category", "Why")}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="click" onClick={() => onOpen(r.claim_id)}>
              <td className="small">{fmtWhen(r.at)}</td><td className="small">{r.user_name}</td><td className="small"><span className="mono">{r.claim_no || "–"}</span><div className="tiny muted">{r.patient} · {r.client_name}</div></td><td className="small">{r.payer}</td><td className="num">{fmtMoney(r.balance)}</td>
              <td className="small">{r.text}<div className="tiny muted">{r.from} → {r.to}</div></td><td className="small" style={{ maxWidth: 320 }}><b>{r.category}</b>{r.comment ? <div className="tiny">{r.comment}</div> : null}</td>
            </tr>))}
            {q.data && !rows.length && <tr><td colSpan={7}><Empty>No priority changes in this period. Change a claim's priority from the Priority column on Claims.</Empty></td></tr>}</tbody></table></div>
      </div>
    </Modal>
  );
}


/* ---------- needs attention: escalations from billers, oldest first; red once past the 24-hour TAT ---------- */
const fmtWait = (ms) => { const h = Math.floor(ms / 3600000); return h >= 48 ? Math.floor(h / 24) + "d " + (h % 24) + "h" : h >= 1 ? h + "h " + Math.floor((ms % 3600000) / 60000) + "m" : Math.max(1, Math.floor(ms / 60000)) + "m"; };
/* Insurance TFL / AFL: one row per client and insurance. Billers fill the limits from their notes; team leads can set or correct them here.
   The open claims near or past the TFL show which insurance and which claims to give priority. */
function LimitsView({ ctx }) {
  const q = useRpc("payers.limits", { today: todayISO() }, []);
  const [clientId, setClientId] = useState("");
  const [find, setFind] = useState("");
  const [show, setShow] = useState("all");
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const sort = useTableSort("past_bal", "desc");
  const all = q.data ? q.data.rows : [];
  const mine = all.filter((r) => !clientId || r.client_id === clientId);
  const rows = sort.sortRows(mine.filter((r) => (!find || (r.payer + " " + r.client_name).toLowerCase().includes(find.toLowerCase()))
    && (show === "all" || (show === "missing" ? !r.tfl_days || !r.afl_days : r.past_n + r.soon_n + r.afl_past_n + r.afl_soon_n > 0))));
  const tot = mine.reduce((a, r) => ({ past: a.past + r.past_n + r.afl_past_n, pastBal: a.pastBal + r.past_bal + r.afl_past_bal, soon: a.soon + r.soon_n + r.afl_soon_n, soonBal: a.soonBal + r.soon_bal + r.afl_soon_bal, missing: a.missing + (!r.tfl_days && r.open_n ? 1 : 0), saved: a.saved + (r.tfl_days || r.afl_days ? 1 : 0) }), { past: 0, pastBal: 0, soon: 0, soonBal: 0, missing: 0, saved: 0 });
  const badDays = (v) => String(v || "").trim() && !limDays(v);
  const save = async () => {
    setBusy(true);
    try { await rpc("payers.saveLimit", { client_id: edit.client_id, payer: edit.payer, tfl_days: edit.tfl, afl_days: edit.afl, note: edit.note }); toast("Saved for " + edit.payer + "."); setEdit(null); q.reload(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  return (
    <div className="stack">
      <div><h1>Insurance TFL / AFL</h1><div className="sub">The timely filing limit (days from DOS) and appeal filing limit (days from the denial / EOB date) of each insurance, per client. Billers fill them from the TFL / AFL boxes in their notes; set or correct them here. Open claims past or within 30 days of the TFL (not yet accepted by the payer) or the AFL (denied, from the denial date in the note) show which insurance and claims to work first; the automatic priority already moves them up.</div></div>
      <div className="grid g4">
        <Kpi label="Past TFL / AFL" value={fmtInt(tot.past)} tone={tot.past ? "bad" : ""} sub={fmtMoney(tot.pastBal) + " open balance"} onClick={() => setShow("risk")} />
        <Kpi label="TFL / AFL in 30 days" value={fmtInt(tot.soon)} tone={tot.soon ? "accent" : ""} sub={fmtMoney(tot.soonBal) + " · work these first"} onClick={() => setShow("risk")} />
        <Kpi label="Insurances saved" value={fmtInt(tot.saved)} tone="good" />
        <Kpi label="No TFL yet" value={fmtInt(tot.missing)} sub="insurances with open claims" onClick={() => setShow("missing")} />
      </div>
      <div className="card tight">
        <div className="row mb" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ width: 240 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} allowAll /></div>
          <input className="input" style={{ width: 220 }} placeholder="Search insurance…" value={find} onChange={(e) => setFind(e.target.value)} />
          <div className="pill-list">{[["all", "All"], ["risk", "Near / past TFL or AFL"], ["missing", "TFL or AFL missing"]].map(([k, l]) => <button key={k} className={"chip " + (show === k ? "on" : "")} onClick={() => setShow(k)}>{l}</button>)}</div>
          <span style={{ flex: 1 }} /><button className="btn sm" onClick={() => setEdit({ client_id: clientId || ((ctx.clients.find((c) => c.active) || {}).id) || "", payer: "", tfl: "", afl: "", note: "", isNew: true })}>+ Add insurance</button>
        </div>
        <ErrorBox error={q.error} />
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap"><table className="t"><thead><tr>{sort.Th("payer", "Insurance")}{sort.Th("client_name", "Client")}{sort.Th("tfl_days", "TFL (days)", "r")}{sort.Th("afl_days", "AFL (days)", "r")}{sort.Th("open_n", "Open claims", "r")}{sort.Th("past_bal", "Past TFL", "r")}{sort.Th("soon_bal", "TFL in 30 days", "r")}{sort.Th("afl_past_bal", "Past AFL", "r")}{sort.Th("afl_soon_bal", "AFL in 30 days", "r")}{sort.Th("updated_at", "Last updated")}<th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.client_id + "|" + r.payer_key}>
              <td className="b small">{r.payer}{r.note ? <div className="tiny muted" style={{ fontWeight: 400 }}>{r.note}</div> : null}</td><td className="small">{r.client_name}</td>
              <td className="num">{r.tfl_days || <span className="muted">–</span>}</td><td className="num">{r.afl_days || <span className="muted">–</span>}</td>
              <td className="num">{fmtInt(r.open_n)}<div className="tiny muted">{fmtMoney(r.open_bal)}</div></td>
              <td className="num">{r.past_n ? <><span className="badge red">{fmtInt(r.past_n)}</span><div className="tiny muted">{fmtMoney(r.past_bal)}</div></> : r.tfl_days ? "0" : <span className="muted">–</span>}</td>
              <td className="num">{r.soon_n ? <><span className="badge amber">{fmtInt(r.soon_n)}</span><div className="tiny muted">{fmtMoney(r.soon_bal)}</div></> : r.tfl_days ? "0" : <span className="muted">–</span>}</td>
              <td className="num">{r.afl_past_n ? <><span className="badge red">{fmtInt(r.afl_past_n)}</span><div className="tiny muted">{fmtMoney(r.afl_past_bal)}</div></> : r.afl_days ? "0" : <span className="muted">–</span>}{r.afl_no_date_n ? <div className="tiny muted" title="Denied claims without a denial / EOB date in a note">{r.afl_no_date_n} no date</div> : null}</td>
              <td className="num">{r.afl_soon_n ? <><span className="badge amber">{fmtInt(r.afl_soon_n)}</span><div className="tiny muted">{fmtMoney(r.afl_soon_bal)}</div></> : r.afl_days ? "0" : <span className="muted">–</span>}</td>
              <td className="small">{r.updated_at ? <>{r.updated_by_name}<div className="tiny muted">{fmtWhen(r.updated_at)}{r.source ? " · from " + r.source : ""}</div></> : <span className="muted">not set</span>}</td>
              <td className="r"><button className="btn sm" onClick={() => setEdit({ client_id: r.client_id, payer: r.payer, tfl: r.tfl_days ? String(r.tfl_days) : "", afl: r.afl_days ? String(r.afl_days) : "", note: r.note || "" })}>{r.tfl_days || r.afl_days ? "Edit" : "Set"}</button></td>
            </tr>))}
            {q.data && !rows.length && <tr><td colSpan={11}><Empty>No insurances here yet. They appear once claims are uploaded, or when billers enter TFL / AFL in a note.</Empty></td></tr>}</tbody></table></div>
      </div>
      {edit && <Modal title={edit.isNew ? "Add insurance TFL / AFL" : "TFL / AFL · " + edit.payer} sub={edit.isNew ? "" : (ctx.clients.find((c) => c.id === edit.client_id) || {}).name} onClose={() => setEdit(null)} narrow
        footer={<><button className="btn" onClick={() => setEdit(null)} disabled={busy}>Cancel</button><button className="btn primary" onClick={save} disabled={busy || !edit.payer.trim() || !edit.client_id || badDays(edit.tfl) || badDays(edit.afl)}>{busy ? "Saving…" : "Save"}</button></>}>
        <div className="stack">
          {edit.isNew && <><ClientPicker ctx={ctx} clientId={edit.client_id} setClientId={(v) => setEdit({ ...edit, client_id: v })} /><Field label="Insurance"><input className="input" value={edit.payer} onChange={(e) => setEdit({ ...edit, payer: e.target.value })} placeholder="as it appears on the claims" autoFocus /></Field></>}
          <div className="grid g2">
            <Field label="TFL (days from DOS)"><input className="input" inputMode="numeric" value={edit.tfl} onChange={(e) => setEdit({ ...edit, tfl: e.target.value })} placeholder="e.g. 90" /></Field>
            <Field label="AFL (days from denial / EOB)"><input className="input" inputMode="numeric" value={edit.afl} onChange={(e) => setEdit({ ...edit, afl: e.target.value })} placeholder="e.g. 180" /></Field>
          </div>
          <Field label="Note (optional)"><input className="input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="e.g. 1 year for corrected claims; per 2026 contract" /></Field>
        </div>
      </Modal>}
    </div>
  );
}
/* Needs attention: escalations from billers, and the client requests the team lead must send to the client. */
function AttentionView(props) {
  const counts = useRpc("attention.count", {}, []);
  const [tab, setTab] = useState(() => (props.params && props.params.tab) || "esc");
  const c = counts.data || {};
  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div><h1>Needs attention</h1><div className="sub">{tab === "esc" ? "Claims your billers escalated to a team lead, on your projects, oldest first." : tab === "desks" ? "Claims Payment posting, Submission or Rejections sent back to AR with Need assistance from AR. They are already first on the biller's list with a notice; review one to give it to another biller or return it to the department. They leave this list once a biller saves an entry on the claim." : "Claims Posting, Submission or Rejections need the client for. Sending them to the client is the team lead's job; mark each one Sent."}</div></div>
        <div className="seg2">{[["esc", "Escalations", c.escalations], ["desks", "Sent back by Posting / Submission", c.from_desks], ["client", "Client requests", c.client_to_send]].map(([k, l, n]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}{n ? <span className="badge amber" style={{ marginLeft: 6 }}>{n}</span> : null}</button>)}</div>
      </div>
      {tab === "esc" ? <EscalationsView {...props} /> : tab === "desks" ? <FromDesksView {...props} /> : <ClientRequestsView {...props} onChanged={() => { counts.reload(); props.refreshAttention && props.refreshAttention(); }} />}
    </div>
  );
}
/* ---------- Escalation tracker (Work): client escalations, one register per client, copied to the client's OneDrive file ---------- */
const ESC_DEPT_TONE = { "Account Receivable": "gray", Submission: "blue", "Payment Posting": "purple", "Benefit Verification": "teal", PCC: "amber", Credentialing: "green", Other: "gray" };
const escBlank = (clientId) => ({ client_id: clientId || "", day: todayISO(), dept: "", raised_who: "", reported_to: "", owner_id: "", email_subject: "", description: "", is_error: "", comment: "", status: "open", rca: "", corrective: "", preventive: "", close_on: "" });
const fmtMDY = (iso) => (iso ? iso.slice(5, 7) + "/" + iso.slice(8, 10) + "/" + iso.slice(2, 4) : "–");
function EscalationTrackerView({ ctx, me, params }) {
  const [clientId, setClientId] = useState((params && params.client_id) || "");
  const [dept, setDept] = useState("");
  const [status, setStatus] = useState((params && params.status) || "open");
  const [dr, setDr] = useState(() => ({ ...newRange("all"), key: "all" }));
  const span = rangeSpan(dr);
  const q = useRpc("escalations.list", { client_id: clientId, dept, status, from: span ? span[0] : "", to: span ? span[1] : "", today: todayISO() }, [clientId, dept, status, dr.key, dr.from, dr.to]);
  const [form, setForm] = useState(null);
  const [why, setWhy] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = q.data || {}, st = d.stats || {}, rows = d.rows || [];
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    setBusy(true);
    try { const r = await rpc("escalations.save", { ...form, today: todayISO() }); toast(form.id ? "Saved." + (d.onedrive ? " The OneDrive file is updated." : "") : "Logged as SR" + r.sr + "." + (d.onedrive ? " Added to the client's OneDrive file." : "")); setForm(null); q.reload(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const saveWhy = async () => {
    setBusy(true);
    try { await rpc("escalations.reason", { id: why.row.id, reason: why.reason, expected_on: why.expected_on }); toast("Reason and expected close date saved."); setWhy(null); q.reload(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const edit = (r) => setForm({ id: r.id, client_id: r.client_id, client_name: r.client_name, sr: r.sr, day: r.day, dept: r.dept, raised_who: r.raised_who, reported_to: r.reported_to, owner_id: r.owner_id || "",
    email_subject: r.email_subject, description: r.description, is_error: r.is_error, comment: r.comment, status: r.status === "resolved" ? "resolved" : "open", rca: r.rca, corrective: r.corrective, preventive: r.preventive, close_on: r.close_on || "" });
  const csv = () => downloadText(toCSV(rows, [["SR No", (r) => "SR" + r.sr], ["Department", (r) => r.dept], ["Client Name", (r) => r.client_name], ["Received (mm/dd/yy)", (r) => fmtMDY(r.day)],
    ["Raised by", (r) => r.raised_who], ["Reported to Purview", (r) => r.reported_to], ["Responding person Purview", (r) => r.owner_name], ["Email Subject", (r) => r.email_subject],
    ["Error description", (r) => r.description], ["Error (Y/N)", (r) => r.is_error], ["Comment", (r) => r.comment], ["Root Cause", (r) => r.rca], ["Corrective Action", (r) => r.corrective],
    ["Preventive Action", (r) => r.preventive], ["Status (Open/Closed)", (r) => r.status_label], ["Close date (mm/dd/yy)", (r) => (r.close_on ? fmtMDY(r.close_on) : "")],
    ["Reason still open", (r) => r.delay_reason], ["Expected close date", (r) => (r.expected_on ? fmtMDY(r.expected_on) : "")]]
    .map(([label, get]) => ({ label, get }))), "Escalation tracker " + todayISO() + ".csv");
  const people = (d.people || []).map((u) => ({ id: u.id, label: u.name + (u.tag ? " (" + u.tag + ")" : "") }));
  const statusCell = (r) => r.status === "resolved" ? <span className="badge green">Closed {fmtMDY(r.close_on)}</span>
    : r.needs_reason ? <span className="badge red">{r.status_label} · {r.open_hours} h · reason needed</span>
    : r.past_expected ? <span className="badge red">{r.status_label} · past expected date</span>
    : r.past_24 ? <span className="badge amber">{r.status_label} · {r.open_hours} h</span>
    : <span className="badge gray">{r.status_label} · {r.open_hours} h</span>;
  return (
    <div className="stack">
      <div className="row between" style={{ alignItems: "flex-end" }}>
        <div style={{ maxWidth: 980 }}><h1>Escalation tracker</h1><div className="sub">Client escalations, one register per client. SMEs and above log and update them. Open past 24 hours, the team lead gives the reason and the expected close date. Every change is saved to the client's OneDrive file.</div></div>
        <button className="btn primary" style={{ flex: "none" }} onClick={() => setForm(escBlank(clientId))}>+ Log an escalation</button>
      </div>
      <div className="grid g5">
        <Kpi label="Open" value={fmtInt(st.open || 0)} tone={st.open ? "bad" : ""} onClick={() => setStatus("open")} />
        <Kpi label="Over 24 h, reason needed" value={fmtInt(st.needs_reason || 0)} tone={st.needs_reason ? "bad" : ""} sub="the team lead gives the reason" onClick={() => setStatus("reason")} />
        <Kpi label="Logged · this month" value={fmtInt(st.logged_month || 0)} />
        <Kpi label="Closed · this month" value={fmtInt(st.closed_month || 0)} tone="good" />
        <Kpi label="Average time to close" value={st.avg_hours == null ? "–" : st.avg_hours + " h"} sub="this month" />
      </div>
      {clientId && d.sla && <div className={"alert " + (d.sla.met ? "info" : "err")}>
        <b>SLA · Escalations, {d.sla.month}: {d.sla.n}</b> against a target of {d.sla.target} · {d.sla.met ? "Green, no escalations this month" : "Red, " + (d.sla.n === 1 ? "one escalation" : d.sla.n + " escalations") + " this month"}
        {d.sla.by_dept.length ? <span className="muted"> ({d.sla.by_dept.map((x) => x.dept + " " + x.n).join(", ")})</span> : null}
        <div className="tiny muted">Counted on the SLA tab (Drishti) for each department's Escalations KPI: 0 is green, 1 or more is red. {d.onedrive ? (d.sla_file && d.sla_file.ok && d.sla_file.files && d.sla_file.files.length ? "The month's file is in " + d.sla_file.files[0].replace(/ › [^›]+$/, "") + (d.sla_file.files.length > 1 ? " and " + (d.sla_file.files.length - 1) + " more" : "") + "." : d.sla_file && !d.sla_file.ok ? "The SLA copy could not be saved: " + d.sla_file.error : "Each month's escalations go to the client's SLA & KPI folder for Drishti.") : "Each month's escalations go to the client's SLA & KPI folder for Drishti once Microsoft 365 is set up on the server."}</div>
      </div>}
      {clientId && (d.onedrive ? (d.file ? (d.file.ok
        ? <div className="alert info">Saved to OneDrive: <b>{d.file.file}</b> · {fmtWhen(d.file.at)}{d.file.link ? <> · <a href={d.file.link} target="_blank" rel="noopener noreferrer">Open the file</a></> : null}</div>
        : <div className="alert err">The OneDrive file could not be updated: {d.file.error}. Entries are still saved here; the file catches up with the next change.</div>)
        : <div className="alert info">The first escalation logged for this client makes its OneDrive file: Brahmastra Clients › {(ctx.clients.find((c) => c.id === clientId) || {}).name} › Escalation Tracker.</div>)
        : <div className="alert info">OneDrive copies start once Microsoft 365 is set up on the server. Entries are saved here meanwhile, and the whole register goes to the file with the first change after that.</div>)}
      <div className="row desk-filters" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ minWidth: 240 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} allowAll /></div>
        <Field label="Department"><Combo value={dept} onChange={(v) => setDept(v || "")} placeholder="All departments" options={[{ id: "", label: "All departments" }, ...(d.depts || []).map((x) => ({ id: x, label: x }))]} /></Field>
        <Field label="Status"><div className="seg2">{[["open", "Open"], ["reason", "Reason needed"], ["resolved", "Closed"], ["all", "All"]].map(([k, l]) => <button key={k} type="button" className={status === k ? "on" : ""} onClick={() => setStatus(k)}>{l}</button>)}</div></Field>
        <DateRange value={dr} onChange={setDr} allowAll label="Received date" />
        <button className="btn sm" style={{ marginLeft: "auto" }} onClick={csv} disabled={!rows.length}>⬇ CSV</button>
      </div>
      <div className="card tight">
        <ErrorBox error={q.error} />
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap"><table className="t"><thead><tr><th>SR No</th><th>Department</th>{!clientId && <th>Client</th>}<th>Received</th><th>Raised by</th><th>Reported to / responding</th><th>Error description</th><th>Error</th><th>Status</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.needs_reason || r.past_expected ? "tat-missed" : ""}>
              <td className="mono small"><b>SR{r.sr}</b></td>
              <td><span className={"badge " + (ESC_DEPT_TONE[r.dept] || "gray")}>{r.dept}</span></td>
              {!clientId && <td className="small">{r.client_name}</td>}
              <td className="small" style={{ whiteSpace: "nowrap" }}>{fmtMDY(r.day)}<div className="tiny muted">logged {fmtWhen(r.created_at)}</div></td>
              <td className="small">{r.raised_who || "–"}</td>
              <td className="small">{r.reported_to || "–"}<div className="tiny muted">responding: {r.owner_name || "–"}</div></td>
              <td className="small" style={{ maxWidth: 380 }}>{r.email_subject ? <div className="tiny muted">✉ {r.email_subject}</div> : null}{r.description}
                {r.comment ? <div className="tiny muted">Comment: {r.comment}</div> : null}
                {r.status === "resolved" ? <div className="tiny" style={{ marginTop: 3 }}><b>Root cause:</b> {r.rca}<br /><b>Corrective:</b> {r.corrective}<br /><b>Preventive:</b> {r.preventive}</div> : null}
                {r.delay_reason && r.status !== "resolved" ? <div className="tiny" style={{ marginTop: 3 }}><b>Still open:</b> {r.delay_reason} <span className="muted">· expected {fmtMDY(r.expected_on)} · {r.delay_by_name}</span></div> : null}</td>
              <td>{r.is_error ? <span className={"badge " + (r.is_error === "Y" ? "red" : "green")}>{r.is_error}</span> : <span className="muted">–</span>}</td>
              <td>{statusCell(r)}</td>
              <td className="r" style={{ whiteSpace: "nowrap" }}>
                {r.can_reason && r.status !== "resolved" && (r.needs_reason || r.past_expected) && <><button className="btn sm primary" onClick={() => setWhy({ row: r, reason: r.delay_reason || "", expected_on: r.expected_on && r.expected_on >= todayISO() ? r.expected_on : "" })}>Give reason</button> </>}
                {r.can_edit && <button className="btn sm" onClick={() => edit(r)}>{r.status === "resolved" ? "View" : "Update"}</button>}
              </td>
            </tr>))}
            {q.data && !rows.length && <tr><td colSpan={10}><Empty>{status === "open" ? "No open escalations." : status === "reason" ? "Nothing open over 24 hours without a reason." : "No escalations match these filters."}</Empty></td></tr>}</tbody></table></div>
      </div>
      {form && (
        <Modal title={form.id ? "SR" + form.sr + " · " + form.client_name : "Log an escalation"} sub={form.id ? "Changes are saved here and to the client's OneDrive file." : "Saved here and to the client's OneDrive file. The SR No is given by itself."} onClose={() => setForm(null)}
          footer={<><button className="btn" onClick={() => setForm(null)} disabled={busy}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : form.id ? "Save changes" : "Save and update OneDrive"}</button></>}>
          <div className="stack">
            <div className="grid g2">
              <Field label="Department"><Combo value={form.dept} onChange={(v) => set("dept", v || "")} placeholder="Pick the department" clearable={false} options={(d.depts || []).map((x) => ({ id: x, label: x }))} /></Field>
              {form.id ? <Field label="Client name"><div className="input" style={{ background: "transparent" }}>{form.client_name}</div></Field>
                : <ClientPicker ctx={ctx} clientId={form.client_id} setClientId={(v) => set("client_id", v)} />}
              <Field label="Received date"><input className="input" type="date" value={form.day} max={todayISO()} onChange={(e) => set("day", e.target.value)} /></Field>
              <Field label="Raised by"><input className="input" value={form.raised_who} onChange={(e) => set("raised_who", e.target.value)} placeholder="Name or role at the client, e.g. Office manager" /></Field>
              <Field label="Reported to Purview"><ComboOther value={form.reported_to} list={(d.people || []).map((u) => u.name)} onChange={(v) => set("reported_to", v || "")} placeholder="Who at Purview it came to" /></Field>
              <Field label="Responding person Purview"><Combo value={form.owner_id} onChange={(v) => set("owner_id", v || "")} placeholder="Who is answering it" options={people} /></Field>
            </div>
            <Field label="Email subject"><input className="input" value={form.email_subject} onChange={(e) => set("email_subject", e.target.value)} placeholder="The subject line of the client's email (leave blank if it came by call)" /></Field>
            <Field label="Error description"><textarea className="textarea" style={{ minHeight: 64 }} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What went wrong, in plain words. No patient names." /></Field>
            <Field label="Comment"><textarea className="textarea" style={{ minHeight: 44 }} value={form.comment} onChange={(e) => set("comment", e.target.value)} placeholder="Anything else (optional)" /></Field>
            <div className="grid g2">
              <Field label="Status"><div className="seg2">{[["open", "Open"], ["resolved", "Closed"]].map(([k, l]) => <button key={k} type="button" className={form.status === k ? "on" : ""} onClick={() => setForm((f) => ({ ...f, status: k, close_on: k === "resolved" ? (f.close_on || todayISO()) : "" }))}>{l}</button>)}</div></Field>
              <Field label="Error (Y/N)"><div className="seg2">{[["Y", "Y · our error"], ["N", "N · not our error"]].map(([k, l]) => <button key={k} type="button" className={form.is_error === k ? "on" : ""} onClick={() => set("is_error", k)}>{l}</button>)}</div></Field>
            </div>
            {form.status === "resolved" && <div className="tiny muted">To close: Error (Y/N), root cause, corrective action, preventive action and the close date.</div>}
            <Field label={"Root cause" + (form.status === "resolved" ? "" : " (needed to close)")}><textarea className="textarea" style={{ minHeight: 44 }} value={form.rca} onChange={(e) => set("rca", e.target.value)} placeholder="Why it happened" /></Field>
            <div className="grid g2">
              <Field label="Corrective action"><textarea className="textarea" style={{ minHeight: 44 }} value={form.corrective} onChange={(e) => set("corrective", e.target.value)} placeholder="What was done to fix this one" /></Field>
              <Field label="Preventive action"><textarea className="textarea" style={{ minHeight: 44 }} value={form.preventive} onChange={(e) => set("preventive", e.target.value)} placeholder="What stops it happening again" /></Field>
            </div>
            {form.status === "resolved" && <Field label="Close date"><input className="input" type="date" value={form.close_on} min={form.day} max={todayISO()} onChange={(e) => set("close_on", e.target.value)} /></Field>}
          </div>
        </Modal>
      )}
      {why && (
        <Modal title={"SR" + why.row.sr + " is open over 24 hours"} sub={why.row.client_name + " · " + why.row.dept + ": " + why.row.description} onClose={() => setWhy(null)} narrow
          footer={<><button className="btn" onClick={() => setWhy(null)} disabled={busy}>Cancel</button><button className="btn primary" onClick={saveWhy} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
          <div className="stack">
            <Field label="Why it is still open"><textarea className="textarea" style={{ minHeight: 70 }} value={why.reason} onChange={(e) => setWhy({ ...why, reason: e.target.value })} placeholder="e.g. Waiting on the client's corrected charge template" /></Field>
            <Field label="Expected close date (TAT)"><input className="input" type="date" min={todayISO()} value={why.expected_on} onChange={(e) => setWhy({ ...why, expected_on: e.target.value })} /></Field>
            <div className="tiny muted">Both go to the client's OneDrive file. If the date passes with the escalation still open, it turns red again and asks for a new date.</div>
          </div>
        </Modal>
      )}
    </div>
  );
}
/* "#/digest?span=...&week=..." (the Monday email's button) → { view: "digest", params: { span, week } } */
function hashNav() {
  const v = (location.hash || "").replace(/^#\/?/, ""); if (!v) return null;
  const [view, q] = v.split("?"); if (!q) return { view, params: null };
  const params = {}; try { new URLSearchParams(q).forEach((val, k) => { params[k] = val; }); } catch (e) {}
  return { view, params };
}
/* The Monday digest as a landscape dashboard: one card per client, worst first, with its SLA score, Billable and Assign FTE,
   AR, escalations and what pulls it down. Download it as a landscape PDF. */
function DigestDashboard({ params, go }) {
  const [span, setSpan] = useState((params && params.span) || "");
  const [week, setWeek] = useState((params && params.week) || "");
  useEffect(() => { if (params && params.span) setSpan(params.span); if (params && params.week) setWeek(params.week); }, [params && params.span, params && params.week]);
  const q = useRpc("digest.dashboard", { span: span || undefined, week: week || undefined }, [span, week]);
  const d = q.data;
  const pdf = () => {
    const st = document.createElement("style"); st.id = "ddPage"; st.textContent = "@page { size: A4 landscape; margin: 8mm }"; document.head.appendChild(st);
    document.body.classList.add("dd-printing");
    setTimeout(() => { try { window.print(); } catch (e) {} setTimeout(() => { document.body.classList.remove("dd-printing"); st.remove(); }, 800); }, 300);
  };
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return <Spinner label="Building the digest…" />;
  if (d.empty) return <div className="card"><h2>Monday digest</h2><Empty>No digests yet: add clients and their managers first, then each manager's clients get a Monday digest.</Empty></div>;
  const R = d.rollup, money = (n) => (n == null ? "–" : Math.abs(n) >= 1e6 ? "$" + Math.round(n / 1e4) / 100 + "M" : Math.abs(n) >= 1e4 ? "$" + Math.round(n / 1e3) + "K" : "$" + Math.round(n).toLocaleString());
  const f1 = (v) => (v == null ? "–" : String(Math.round(v * 10) / 10));
  const dd = (iso) => fmtDate(iso).replace(/, \d{4}$/, "");
  const bandWord = { ok: "Green", warn: "Amber", miss: "Red" };
  return (
    <div className="dd">
      <div className="dd-top">
        <div><div className="k">BRAHMASTRA · MONDAY DIGEST</div><h1>{d.span.title}</h1></div>
        <div className="dd-meta"><div>Manager<b>{d.manager ? d.manager.name + " · " + d.manager.designation : "No manager (VP and admins)"}</b></div>
          <div>Period<b>Week of {dd(d.week.first)} to {dd(d.week.last)}</b></div>
          <div>Clients<b>{d.clients.length}{R.sla_avg != null ? " · " + [R.bands.ok && R.bands.ok + " green", R.bands.warn && R.bands.warn + " amber", R.bands.miss && R.bands.miss + " red"].filter(Boolean).join(" · ") : ""}</b></div></div>
        <div className="dd-tools no-print">
          {d.spans.length > 1 && <select className="input sm" value={d.span.key} onChange={(e) => setSpan(e.target.value)}>{d.spans.map((x) => <option key={x.key} value={x.key}>{x.title}</option>)}</select>}
          <select className="input sm" value={d.week.week} onChange={(e) => setWeek(e.target.value)}>{d.weeks.map((w, i) => <option key={w.week} value={w.week}>{i === 0 ? "This digest: " : ""}week of {dd(w.first)} to {dd(w.last)}</option>)}</select>
          <button className="btn sm" onClick={pdf}>⬇ PDF (landscape)</button>
        </div>
      </div>
      {(d.notices || []).map((n, i) => <div key={i} className="alert warn no-print">{n}</div>)}
      <div className="dd-kpis">
        <div><b>{R.sla_avg == null ? "–" : R.sla_avg + "%"}</b><span>avg SLA score{R.sla_month ? " · " + R.sla_month : ""}</span></div>
        <div className="g"><b>{R.bands.ok}</b><span>green</span></div><div className="a"><b>{R.bands.warn}</b><span>amber</span></div><div className="r"><b>{R.bands.miss}</b><span>red{R.bands.miss ? " · needs a plan" : ""}</span></div>
        <div className={R.esc && R.esc.n ? "r" : "g"}><b>{R.esc ? R.esc.n : "–"}</b><span>escalations{R.esc ? " · " + R.esc.month : ""} · target 0</span></div>
        <div><b>{money(R.ar)}</b><span>AR{R.ar_ago != null ? (R.ar_ago <= 0 ? " · down " : " · up ") + money(Math.abs(R.ar_ago)) : ""}</span></div>
        <div className={R.pct > R.target ? "r" : ""}><b>{R.pct}%</b><span>over 90 · target {R.target}%</span></div>
        <div><b>{money(R.coll)}</b><span>collected · {fmtInt(R.work)} entries</span></div>
      </div>
      <div className="dd-grid">{d.clients.map((c) => {
        const b = c.card ? c.card.band : "none", ppl = [c.tls.length ? (c.tls.length > 1 ? "TLs " : "TL ") + c.tls.join(", ") : "", c.smes.length ? (c.smes.length > 1 ? "SMEs " : "SME ") + c.smes.join(", ") : ""].filter(Boolean).join(" · ");
        return (
          <div key={c.id} className={"dd-card " + b}>
            <div className="dd-hd"><div className={"dd-dial " + b}>{c.card ? c.card.score + "%" : "–"}</div>
              <div><div className="nm">{c.name} {c.card && <span className={"badge " + drBandUi(c.card.band)[1]}>{bandWord[c.card.band]}</span>}</div>
                <div className="mt">{c.card ? `${c.card.period} · ${c.card.kpi_ok} of ${c.card.kpi_n} KPIs on target` : "Not scored in Drishti yet"}{c.card && c.card.delta != null ? <> · {c.card.delta ? <b className={c.card.delta > 0 ? "teal-ink" : "red-ink"}>{c.card.delta > 0 ? "▲" : "▼"} {Math.abs(c.card.delta)} pts</b> : <span className="muted">no change</span>}</> : null}</div>
                {ppl && <div className="mt">{ppl}</div>}</div></div>
            <div className="dd-fte"><div><span>Billable FTE</span><b>{c.wfm ? f1(c.wfm.billable) : "–"}</b></div><div><span>Assign FTE</span><b className={c.wfm && c.wfm.billable != null && c.wfm.assigned_fte < c.wfm.billable ? "amber-ink" : ""}>{c.wfm ? f1(c.wfm.assigned_fte) : "–"}</b></div></div>
            <div className="dd-mini">
              <div><b>{money(c.ar.now)}</b><span>AR{c.ar.week_ago != null ? (c.ar.now <= c.ar.week_ago ? " · down " : " · up ") + money(Math.abs(c.ar.now - c.ar.week_ago)) : ""}</span></div>
              <div><b className={c.ar.over90_pct > c.ar.target ? "red-ink" : ""}>{c.ar.over90_pct}%</b><span>over 90</span></div>
              <div><b>{money(c.collected.amount)}</b><span>collected · {fmtInt(c.worked.n)} entries</span></div>
            </div>
            {c.card && c.card.scopes.length > 0 && <div className="dd-scopes">{c.card.scopes.map((x) => <span key={x.name}>{drDot(x.band)}{x.name} {x.pct == null ? "–" : x.pct + "%"}</span>)}</div>}
            {c.esc && <div className={"dd-esc " + (c.esc.n ? "r" : "g")}>Escalations · {c.esc.from ? dd(c.esc.from).split(" ")[0] : ""}: <b>{c.esc.n}</b> (target 0){c.esc.n ? <> · {c.esc.by_dept.map((x) => x.dept + " " + x.n).join(", ")} · {c.esc.open ? <b>{c.esc.open} open</b> : "all closed"}{c.esc.over24 ? ` · ${c.esc.over24} over 24 h` + (c.esc.over24_reason ? ` (${c.esc.over24_reason} with a reason)` : ", no reason yet") : ""}{c.esc.errors ? " · our error " + c.esc.errors : ""}</> : " · Green"}</div>}
            {c.card && (c.card.drags.length ? <table className="dd-t"><thead><tr><th>Pulling it down</th><th>Value</th><th>Standard</th><th></th></tr></thead>
              <tbody>{c.card.drags.map((x) => <tr key={x.scope + x.name}><td>{x.scope} · {x.name}</td><td>{x.shown}</td><td>{x.target || "–"}</td><td><span className={"badge " + (x.status === "miss" ? "red" : "amber")}>{x.status === "miss" ? "Red" : "Amber"}</span></td></tr>)}</tbody></table>
              : <div className="mt teal-ink" style={{ marginTop: 8 }}>Every KPI on target.</div>)}
            {c.card && c.card.more > 0 && <div className="mt">+ {c.card.more} more in red or amber</div>}
            {c.card && c.card.band === "ok" && c.card.strengths.length > 0 && <div className="mt teal-ink" style={{ marginTop: 6 }}>Strength: {c.card.strengths.map((x) => x.name + " " + x.shown).join(", ")}</div>}
            <div className="dd-links no-print"><button className="btn sm link" onClick={() => go("sla", { tab: "scorecard", client_id: c.id })}>SLA scorecard</button><button className="btn sm link" onClick={() => go("client", { client_id: c.id })}>Client 360</button><button className="btn sm link" onClick={() => go("escalations", { client_id: c.id })}>Escalations</button></div>
          </div>);
      })}</div>
      <div className="dd-att"><div className="cv-sec">Needs your attention</div>
        {R.attention.length ? R.attention.slice(0, 8).map(([t, cl, x], i) => <div key={i} className="li"><span className={t === "red" ? "red-ink" : "amber-ink"}>●</span> <b>{cl}</b>: {x}</div>) : <div className="muted">Nothing needs you this week.</div>}
        {R.good.length > 0 && <div className="teal-ink" style={{ marginTop: 4 }}>Good news: {R.good.slice(0, 2).join("; ")}.</div>}</div>
    </div>
  );
}
/* Sent back by Posting / Submission / Rejections with "Need assistance from AR": the AR team lead sees what came back, why, and
   whether the biller has picked it up. A row leaves once AR saves a work entry on the claim. */
function FromDesksView({ ctx, me, refreshAttention }) {
  const q = useRpc("attention.fromDesks", {}, []);
  const [open, setOpen] = useState(null);
  const [review, setReview] = useState(null);
  const rows = q.data ? q.data.rows : [];
  return (
    <>
      {rows.some((r) => r.late) && <div className="alert err"><b>{rows.filter((r) => r.late).length} waiting more than a working day</b> since the department sent them back. Make sure the biller picks them up.</div>}
      <div className="card tight">
        <ErrorBox error={q.error} />
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap"><table className="t"><thead><tr><th>Sent back</th><th>Department</th><th>Claim #</th><th>Patient</th><th>Client</th><th>Why AR is needed</th><th>Biller</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.late ? "tat-missed" : ""}>
              <td className="small">{r.late ? <span className="badge red">{fmtWhen(r.done_at)}</span> : fmtWhen(r.done_at)}<div className="tiny muted">by {r.done_by_name || "the department"}</div></td>
              <td><span className={"badge " + (r.dept === "posting" ? "purple" : r.dept === "rejection" ? "red" : "blue")}>{r.dept_label}</span>{r.returns >= 2 && <div><span className={"badge " + (r.returns >= 3 ? "red" : "amber")} style={{ marginTop: 3 }}>Returned {r.returns}×</span></div>}</td>
              <td className="mono small">{r.claim_no || "–"}</td><td>{r.patient}<div className="tiny muted">{r.account_no}</div></td>
              <td className="small">{r.client_name}{r.location_name ? " · " + r.location_name : ""}</td>
              <td className="small" style={{ maxWidth: 320 }}><b>{r.reason || "–"}</b>{r.note ? <div className="tiny muted" title={r.note}>“{r.note.length > 140 ? r.note.slice(0, 140) + "…" : r.note}”</div> : null}</td>
              <td className="small">{r.biller_name || <span className="muted">not on a desk</span>}</td>
              <td className="r" style={{ whiteSpace: "nowrap" }}>{r.reviewed && <span className="badge green" title={"Reviewed by " + r.reviewed_by_name}>Reviewed</span>} <button className="btn sm" onClick={() => setOpen(r.claim_id)}>Open claim</button> <button className="btn sm primary" onClick={() => setReview({ ...r, review_why: r.dept_label + " sent it back: " + (r.reason || "need assistance from AR"), review_context: r.note })}>Review</button></td>
            </tr>))}
            {q.data && !rows.length && <tr><td colSpan={8}><Empty>Nothing sent back by Posting, Submission or Rejections is waiting on AR.</Empty></td></tr>}</tbody></table></div>
      </div>
      {open && <ClaimDrawer id={open} ctx={ctx} me={me} onClose={() => { setOpen(null); q.reload(); }} onChanged={() => q.reload()} />}
      {review && <ReviewModal row={review} people={q.data ? q.data.people : []} onClose={() => setReview(null)} onDone={() => { setReview(null); q.reload(); refreshAttention && refreshAttention(); }} />}
    </>
  );
}
const SENT_HOW_UI = ["Email", "Client portal", "Call", "Fax", "Other"];
function ClientRequestsView({ ctx, me, onChanged, params }) {
  const q = useRpc("attention.clientRequests", {}, []);
  const [show, setShow] = useState("to_send");
  const [only, setOnly] = useState((params && params.client_id) || "");
  const [sent, setSent] = useState(null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const all = q.data ? q.data.rows.filter((r) => !only || r.client_id === only) : [];
  const rows = all.filter((r) => (show === "to_send" ? !r.client_sent_at : r.client_sent_at));
  const save = async () => {
    setBusy(true);
    try { await rpc("attention.clientSent", { id: sent.row.id, how: sent.how, note: sent.note }); toast("Marked sent to the client. The department chases it in 3 working days."); setSent(null); q.reload(); onChanged && onChanged(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  return (
    <>
      {only && <div className="row" style={{ gap: 6 }}><label className="check small"><input type="checkbox" checked onChange={() => setOnly("")} /> Only {(ctx.clients.find((c) => c.id === only) || {}).name || "one client"}</label></div>}
      {q.data && q.data.late > 0 && <div className="alert err"><b>{q.data.late} not sent within a working day.</b> Send these to the client first.</div>}
      <div className="row between">
        <div className="seg2">{[["to_send", "To send", all.filter((r) => !r.client_sent_at).length], ["sent", "Sent, waiting for the client", all.filter((r) => r.client_sent_at).length]].map(([k, l, n]) => <button key={k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>{l} {n}</button>)}</div>
        <div className="small muted">The TAT keeps running; the department chases the client 3 working days after it is sent.</div>
      </div>
      <div className="card tight">
        <ErrorBox error={q.error} />
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap"><table className="t"><thead><tr><th>Asked</th><th>Claim #</th><th>Patient</th><th>Client</th><th>Department</th><th>What is needed from the client</th><th>{show === "sent" ? "Sent" : "Biller"}</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.late ? "tat-missed" : ""}>
              <td className="small">{r.late ? <span className="badge red">not sent · {fmtWhen(r.asked_at)}</span> : fmtWhen(r.asked_at)}<div className="tiny muted">by {r.asked_by || "the department"}</div></td>
              <td className="mono small">{r.claim_no || "–"}</td><td>{r.patient}<div className="tiny muted">{r.account_no}</div></td>
              <td className="small">{r.client_name}{r.location_name ? " · " + r.location_name : ""}</td>
              <td><span className={"badge " + (r.dept === "posting" ? "purple" : r.dept === "rejection" ? "red" : "blue")}>{r.dept_label}</span></td>
              <td className="small" style={{ maxWidth: 360 }}><b>{r.reason}</b>{r.note ? <div className="tiny">{r.note}</div> : null}</td>
              <td className="small">{show === "sent" ? <>{r.client_sent_by_name}<div className="tiny muted">{fmtWhen(r.client_sent_at)} · {r.client_sent_how}</div>{r.chase ? <span className="badge amber">chase the client</span> : <div className="tiny muted">chase {fmtWhen(r.chase_at)}</div>}</> : r.biller_name || "–"}</td>
              <td className="r" style={{ whiteSpace: "nowrap" }}><button className="btn sm" onClick={() => setOpen(r.claim_id)}>Open claim</button>{!r.client_sent_at && <> <button className="btn sm primary" onClick={() => setSent({ row: r, how: "Email", note: "" })}>Mark sent to client</button></>}</td>
            </tr>))}
            {q.data && !rows.length && <tr><td colSpan={8}><Empty>{show === "to_send" ? "Nothing to send. Requests arrive here when Posting, Submission or Rejections mark a claim Need client assistance." : "Nothing waiting on a client."}</Empty></td></tr>}</tbody></table></div>
      </div>
      {open && <ClaimDrawer id={open} ctx={ctx} me={me} onClose={() => setOpen(null)} onChanged={() => q.reload()} />}
      {sent && (
        <Modal title={"Sent to the client · " + (sent.row.claim_no || sent.row.patient)} sub={sent.row.client_name + " · " + sent.row.dept_label + " needs: " + sent.row.reason} onClose={() => setSent(null)} narrow
          footer={<><button className="btn" onClick={() => setSent(null)} disabled={busy}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Mark sent"}</button></>}>
          <div className="stack">
            {sent.row.note && <div className="cell small">{sent.row.note}</div>}
            <Field label="How it was sent"><div className="seg2">{SENT_HOW_UI.map((h) => <button key={h} type="button" className={sent.how === h ? "on" : ""} onClick={() => setSent({ ...sent, how: h })}>{h}</button>)}</div></Field>
            <Field label="Comment (optional)"><textarea className="textarea" style={{ minHeight: 60 }} value={sent.note} onChange={(e) => setSent({ ...sent, note: e.target.value })} placeholder="e.g. Emailed Dr Vontella's office manager, asked for the ERA by Friday" /></Field>
            <div className="tiny muted">The department sees who sent it and when. If the client has not answered in 3 working days, it comes back to them as Chase the client.</div>
          </div>
        </Modal>
      )}
    </>
  );
}
/* Supervisor review of a Needs attention claim: why it came, what was reviewed, the findings and the next action, then where
   it goes: the biller who sent it, another biller, or back to the department. */
function ReviewModal({ row, people, onClose, onDone }) {
  const [f, setF] = useState(() => ({ why: row.review_why || "", reviewed: "", findings: "", next: "", route: row.sent_by_id ? "biller" : "other", user_id: "", dept: row.last_dept || (row.depts && row.depts[0] ? row.depts[0].id : "") }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const words = (t) => t.trim().length >= 8;
  const ok = f.why.trim().length >= 3 && words(f.reviewed) && words(f.findings) && words(f.next) && (f.route === "biller" ? !!row.sent_by_id : f.route === "other" ? !!f.user_id : !!f.dept);
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await rpc("attention.review", { id: row.claim_id || row.id, why: f.why, reviewed: f.reviewed, findings: f.findings, next: f.next, route: f.route, sent_by: row.sent_by_id, user_id: f.user_id, dept: f.dept, today: todayISO() });
      toast(f.route === "dept" ? "Reviewed and returned to " + r.to + " with your notes." : "Reviewed and given to " + r.to + ": first on their list, with a notice."); onDone(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const depts = row.depts || [];
  return (
    <Modal title={"Review · " + (row.claim_no || row.patient || "claim")} sub={[row.client_name, row.patient, row.payer].filter(Boolean).join(" · ")} onClose={onClose}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" disabled={busy || !ok} onClick={go}>{busy ? "Saving…" : "Save review and send"}</button></>}>
      <div className="stack">
        {row.review_context && <div className="cell small">{row.review_context}</div>}
        <div className="grid g2">
          <Field label="1. Why it came to you"><textarea className="textarea" style={{ minHeight: 56 }} value={f.why} onChange={(e) => set("why", e.target.value)} placeholder="e.g. Escalated by the biller: payer says the claim was never received" /></Field>
          <Field label="2. What you reviewed"><textarea className="textarea" style={{ minHeight: 56 }} value={f.reviewed} onChange={(e) => set("reviewed", e.target.value)} placeholder="e.g. Claim history, the payer portal and the clearinghouse report" autoFocus /></Field>
          <Field label="3. Findings"><textarea className="textarea" style={{ minHeight: 56 }} value={f.findings} onChange={(e) => set("findings", e.target.value)} placeholder="e.g. Submitted to the wrong payer ID" /></Field>
          <Field label="4. Next action"><textarea className="textarea" style={{ minHeight: 56 }} value={f.next} onChange={(e) => set("next", e.target.value)} placeholder="e.g. Correct the payer ID and resubmit today" /></Field>
        </div>
        <Field label="Send it to">
          <div className="stack" style={{ gap: 8 }}>
            <label className="check"><input type="radio" name="rv" checked={f.route === "biller"} disabled={!row.sent_by_id} onChange={() => set("route", "biller")} /> {row.sent_by_id ? <>The biller who sent it: <b>{row.sent_by_name || "the biller"}</b></> : "The biller who sent it (nobody on record)"}</label>
            <label className="check"><input type="radio" name="rv" checked={f.route === "other"} onChange={() => set("route", "other")} /> Another biller</label>
            {f.route === "other" && <div style={{ marginLeft: 24, maxWidth: 320 }}><Combo value={f.user_id} onChange={(v) => set("user_id", v || "")} placeholder="Pick the biller…" options={(people || []).filter((p) => p.id !== row.sent_by_id).map((p) => ({ id: p.id, label: p.name }))} /></div>}
            <label className="check"><input type="radio" name="rv" checked={f.route === "dept"} disabled={!depts.length} onChange={() => set("route", "dept")} /> Back to the department{row.last_dept ? " that sent it" : ""}{!depts.length ? " (none set on this client)" : ""}</label>
            {f.route === "dept" && <div className="seg2" style={{ marginLeft: 24 }}>{depts.map((d) => <button key={d.id} type="button" className={f.dept === d.id ? "on" : ""} onClick={() => set("dept", d.id)}>{d.label}{row.last_dept === d.id ? " (sent it)" : ""}</button>)}</div>}
          </div>
        </Field>
        <div className="tiny muted">{f.route === "dept" ? "It goes back on the department's desk with the client's TAT. Your four notes go on the claim's timeline; the claim's notes and work stay as they are." : "It goes to the top of the biller's list with a notice. Your four notes go on the claim's timeline (who escalated it, who reviewed it, what was found and where it went); the claim's notes and work stay as they are."}</div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}
function EscalationsView({ ctx, me, refreshAttention }) {
  const q = useRpc("attention.list", {}, []);
  const [open, setOpen] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = q.data ? q.data.rows : [];
  const send = async () => {
    setBusy(true);
    try { const r = await rpc("attention.answer", { id: answer.row.id, comment: answer.text, send_back: answer.back }); toast(r.sent_back ? "Answered and back on " + (answer.row.assigned_name || "the biller") + "'s list today." : "Answered."); setAnswer(null); q.reload(); refreshAttention && refreshAttention(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  return (
    <>
      <div><div className="sub">Review within {q.data ? q.data.tat_hours : 24} hours: write why it came, what you reviewed, your findings and the next action, then give it to the biller who sent it, another biller, or back to the department; after that they turn red and a reminder stays at the top of every screen until they are answered.</div></div>
      {q.data && q.data.overdue > 0 && <div className="alert err"><b>{q.data.overdue} past the 24-hour TAT.</b> Answer these first.</div>}
      <div className="card tight">
        <ErrorBox error={q.error} />
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap"><table className="t"><thead><tr><th>Waiting</th><th>Claim #</th><th>Patient</th><th>Client</th><th>Payer</th><th className="r">Balance</th><th>Biller</th><th>Last entry</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className={r.overdue ? "tat-missed" : ""}>
              <td>{r.overdue ? <span className="badge red">TAT missed · {fmtWait(r.waiting_ms)}</span> : <span className={"badge " + (r.waiting_ms > 18 * 3600000 ? "amber" : "gray")}>{fmtWait(r.waiting_ms)}</span>}<div className="tiny muted">since {fmtWhen(r.escalated_at)}</div></td>
              <td className="mono small">{r.claim_no || "–"}</td><td>{r.patient}<div className="tiny muted">{r.account_no}</div></td><td className="small">{r.client_name}{r.location_name ? " · " + r.location_name : ""}</td><td className="small">{r.payer}</td><td className="num">{fmtMoney(r.balance)}</td>
              <td className="small">{r.escalated_by_name || r.assigned_name || "–"}</td>
              <td className="small" style={{ maxWidth: 340 }}>{r.last_status_code ? <b>{r.last_status_code}{r.last_sub_status ? " › " + r.last_sub_status : ""}</b> : null}<div className="tiny" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{r.last_note}</div></td>
              <td className="r" style={{ whiteSpace: "nowrap" }}><button className="btn sm" onClick={() => setOpen(r.id)}>Open claim</button> <button className="btn sm primary" onClick={() => setReview({ ...r, review_why: "Escalated by " + (r.sent_by_name || "the biller") + (r.last_status_code ? " (" + r.last_status_code + (r.last_sub_status ? " › " + r.last_sub_status : "") + ")" : ""), review_context: r.last_note })}>Review</button></td>
            </tr>))}
            {q.data && !rows.length && <tr><td colSpan={9}><Empty>Nothing escalated. Billers flag a claim for their team lead from the work form.</Empty></td></tr>}</tbody></table></div>
      </div>
      {open && <ClaimDrawer id={open} ctx={ctx} me={me} onClose={() => setOpen(null)} onChanged={() => q.reload()} />}
      {review && <ReviewModal row={review} people={q.data ? q.data.people : []} onClose={() => setReview(null)} onDone={() => { setReview(null); q.reload(); refreshAttention && refreshAttention(); }} />}
      {answer && (
        <Modal title={"Answer the escalation · " + (answer.row.claim_no || answer.row.patient)} sub={"Your answer goes into the claim history for " + (answer.row.escalated_by_name || answer.row.assigned_name || "the biller") + " and the flag comes off."} onClose={() => setAnswer(null)} narrow
          footer={<><button className="btn" onClick={() => setAnswer(null)} disabled={busy}>Cancel</button><button className="btn primary" onClick={send} disabled={busy || answer.text.trim().length < 8}>{busy ? "Saving…" : "Send answer"}</button></>}>
          <div className="stack">
            {answer.row.last_note && <div className="cell small">{answer.row.last_note}</div>}
            <Field label="Your answer"><textarea className="textarea" value={answer.text} onChange={(e) => setAnswer({ ...answer, text: e.target.value })} placeholder="What the biller should do next…" autoFocus /></Field>
            {answer.row.assigned_to && <label className="check"><input type="checkbox" checked={answer.back} onChange={(e) => setAnswer({ ...answer, back: e.target.checked })} /> Put it back on {answer.row.assigned_name || "the biller"}'s list today</label>}
          </div>
        </Modal>
      )}
    </>
  );
}
/* ---------- the claim view, the same for every profile: insurance & patient side by side, suggestions, the note,
   and the claim's history in a panel that slides in from the right ---------- */
function ClaimHeader({ c, children }) {
  return (
    <div className="row between" style={{ gap: 10, flexWrap: "wrap" }}>
      <div className="cv-head"><span className="no">{c.claim_no || "No claim #"}</span><StateBadge state={c.state} /><TierBadge tier={c.tier} /><ClassBadge cls={c.status_class} /><KindBadge claim={c} />{c.escalated ? <span className="badge red">escalated</span> : null}<HandoffBadge status={c.handoff_status} style={{ marginLeft: 0 }} />
        <span className="muted small">{c.client_name || ""}{c.location_name ? " · " + c.location_name : ""}</span></div>
      <div className="row" style={{ gap: 6 }}>{children}</div>
    </div>
  );
}
function LimitTfl({ c }) {
  const d = c.payer_limits && c.payer_limits.tfl_days;
  if (!d) return <span className="muted" style={{ fontWeight: 400 }}>not saved</span>;
  const dl = tflDeadline(c.dos, d), left = dl ? daysUntil(dl) : null;
  return <>{d} days{dl ? <> · by {fmtDate(dl)} <span className={"badge " + (left < 0 ? "red" : left <= 30 ? "amber" : "gray")}>{left < 0 ? Math.abs(left) + "d past" : left + "d left"}</span></> : null}</>;
}
function LimitAfl({ c }) {
  const d = c.payer_limits && c.payer_limits.afl_days;
  if (!d) return <span className="muted" style={{ fontWeight: 400 }}>not saved</span>;
  const dl = tflDeadline(c.denial_date, d), left = dl ? daysUntil(dl) : null;
  return <>{d} days{dl ? <> · by {fmtDate(dl)} <span className={"badge " + (left < 0 ? "red" : left <= 30 ? "amber" : "gray")}>{left < 0 ? Math.abs(left) + "d past" : left + "d left"}</span></> : <span className="muted" style={{ fontWeight: 400 }}> · from the denial date (not entered yet)</span>}</>;
}
/* The file's own columns side by side (two or three to a row, long text across the full width); Excel date numbers shown as dates. */
const fileCell = (k, v) => {
  const s = String(v == null ? "" : v);
  if (/date|dos|dob|service|worked on|work dt|birth/i.test(k) && /^\d{5}(\.\d+)?$/.test(s.trim())) { const n = Number(s); if (n > 20000 && n < 90000) return fmtDate(excelSerialToISO(n)); }
  return s;
};
function FileColumns({ raw }) {
  return (
    <div className="mt8" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "6px 18px" }}>
      {Object.entries(raw).map(([k, v]) => { const val = fileCell(k, v); const wide = val.length > 60;
        return <div key={k} style={{ gridColumn: wide ? "1 / -1" : undefined, display: "grid", gridTemplateColumns: "130px 1fr", gap: 8, alignItems: "baseline", minWidth: 0 }}>
          <span className="tiny muted b" style={{ overflowWrap: "anywhere" }}>{k}</span><span className="small" style={{ overflowWrap: "anywhere" }}>{val}</span></div>; })}
    </div>
  );
}
/* The latest work on a claim (SAAG status, action, who and when, and the full note), first on the claim, for billers and supervisors alike. */
function LatestWork({ c }) {
  if (!c.last_status_code && !c.last_note) return null;
  const when = c.last_worked_on || "";
  return (
    <div className="card tight latest-work">
      <div className="row between"><div className="cv-sec" style={{ margin: 0 }}>📝 Latest work</div>
        <div className="tiny muted">{c.last_worked_name ? "by " + c.last_worked_name : ""}{when ? (c.last_worked_name ? " · " : "") + (/^\d{4}-\d{2}-\d{2}$/.test(when) ? fmtDate(when) : when) : ""}{c.worked_before && !c.last_worked_name ? " · from an earlier upload" : ""}</div></div>
      {c.last_status_code && <div className="mt8"><b>{c.last_status_code}{c.last_sub_status ? " › " + c.last_sub_status : ""}</b></div>}
      <div className="row mt8" style={{ gap: 6, flexWrap: "wrap" }}>
        {c.last_action_code && <span className="badge">{c.last_action_code}</span>}{c.last_bucket && <span className="badge gray">{c.last_bucket}</span>}
        {c.last_effective && <span className="badge gray">effective {c.last_effective}</span>}{c.follow_up_on && <span className="badge amber">follow up {fmtDate(c.follow_up_on)}</span>}
      </div>
      {c.last_note && <div className="small mt8 latest-note">{c.last_note}</div>}
    </div>
  );
}
function ClaimInfo({ c, siblings }) {
  const raw = c.raw || {};
  const [more, setMore] = useState(false);
  const lines = Array.isArray(c.lines) ? c.lines : [];
  return (
    <div className="stack" style={{ gap: 14 }}>
      <LatestWork c={c} />
      <div className="grid g2">
        <div className="card tight"><div className="cv-sec">🏥 Insurance &amp; claim</div>
          <dl className="cv-kv">
            <dt>Payer</dt><dd>{c.payer || "–"}</dd><dt>Claim #</dt><dd className="mono">{c.claim_no || "–"}</dd>
            <dt>Date of service</dt><dd>{fmtDate(c.dos)}</dd><dt>Age</dt><dd>{c.age_days != null ? `${c.age_days} days · ${c.bucket}` : "–"}</dd>
            <dt>CPT</dt><dd className="mono">{c.cpt || "–"}</dd><dt>Billed</dt><dd>{c.billed != null ? fmtMoney(c.billed, 2) : "–"}</dd>
            <dt>Balance</dt><dd className="mono">{fmtMoney(c.balance, 2)}{lines.length > 1 ? <span className="muted"> · {lines.length} lines</span> : null}</dd><dt>File status</dt><dd>{c.file_status || "–"}{c.file_sub_status ? <span className="muted"> · {c.file_sub_status}</span> : null}</dd>
            <dt>Follow-up on</dt><dd>{c.follow_up_on ? fmtDate(c.follow_up_on) : "–"}</dd><dt>Priority</dt><dd title={c.priority_reason}>{c.priority} · {c.tier}</dd>
            <dt>TFL</dt><dd><LimitTfl c={c} /></dd><dt>AFL</dt><dd><LimitAfl c={c} /></dd>
          </dl>
        </div>
        <div className="card tight"><div className="cv-sec">👤 Patient</div>
          <dl className="cv-kv">
            <dt>Patient</dt><dd>{c.patient || "–"}</dd><dt>Account #</dt><dd className="mono">{c.account_no || "–"}</dd>
            {(c.patient_dob || c.member_id) && <><dt>DOB</dt><dd>{c.patient_dob ? (/^\d{4}-\d{2}-\d{2}$/.test(c.patient_dob) ? fmtDate(c.patient_dob) : c.patient_dob) : "–"}</dd><dt>Member ID</dt><dd className="mono">{c.member_id || "–"}</dd></>}
            {c.patient_phone && <><dt>Phone</dt><dd>{c.patient_phone}</dd><dt></dt><dd></dd></>}
            <dt>Client</dt><dd>{c.client_name || "–"}</dd><dt>Location</dt><dd>{c.location_name || "–"}</dd>
            <dt>Provider</dt><dd>{c.provider || "–"}</dd><dt>Assigned to</dt><dd>{c.assigned_name || "–"}{c.assigned_at ? <div className="tiny muted" style={{ fontWeight: 400 }}>{fmtWhen(c.assigned_at)}</div> : null}</dd>
            <dt>Other claims</dt><dd>{siblings && siblings.length ? `${siblings.length} open for this patient` : "none open"}</dd><dt>Suggested</dt><dd style={{ fontWeight: 400 }}>{STATUS_ACTION[c.status_class] || STATUS_ACTION.unknown}</dd>
          </dl>
          <div className="small mt8"><span className="tiny muted b">FROM THE FILE </span>{!more && c.file_comments ? <span className="muted">{String(c.file_comments).slice(0, 160)}{String(c.file_comments).length > 160 ? "…" : ""}</span> : null}
            <button className="btn sm link" onClick={() => setMore(!more)}>{more ? "Less" : "Full claim details ▾"}</button></div>
          {c.state_reason && <div className="tiny muted mt8">State note: {c.state_reason}</div>}
        </div>
      </div>
      {more && (
        <div className="card tight">
          <dl className="kv"><dt>Status</dt><dd>{c.file_status || "–"}</dd><dt>Sub status</dt><dd>{c.file_sub_status || "–"}</dd><dt>Action</dt><dd>{c.file_action || "–"}</dd>
            <dt>Comments</dt><dd style={{ whiteSpace: "pre-wrap" }}>{c.file_comments || "–"}</dd>{c.file_bucket && <><dt>Bucket</dt><dd>{c.file_bucket}</dd></>}
            {Object.keys(raw).length > 0 && <><dt>All file columns</dt><dd><FileColumns raw={raw} /></dd></>}</dl>
          {lines.length > 1 && <div className="mt8"><div className="tiny muted b">SERVICE LINES</div><table className="t"><thead><tr><th>CPT</th><th>DOS</th><th className="r">Balance</th></tr></thead><tbody>{lines.map((l, i) => <tr key={i}><td className="mono small">{l.cpt || "–"}</td><td className="small">{fmtDate(l.dos)}</td><td className="num">{fmtMoney(l.balance, 2)}</td></tr>)}</tbody></table></div>}
        </div>
      )}
    </div>
  );
}
/* A note in the standard format without a SAAG entry (the SAAG entry is done from Work this claim). */
function NoteForm({ c, files, onChanged }) {
  const blank = () => ({ dos: c.dos || "", clm: c.claim_no || "", denial: c.file_sub_status || "", source: "", ref: "", precheck: [], precheck_text: "", findings: "", ...limitsInit(c) });
  const [note, setNote] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const setN = (k) => (v) => setNote((n) => ({ ...n, [k]: v }));
  const togglePre = (p) => setNote((n) => ({ ...n, precheck: n.precheck.includes(p) ? n.precheck.filter((x) => x !== p) : [...n.precheck, p] }));
  const missing = [];
  if (String(note.findings || "").trim().length < 8) missing.push("RCA / findings");
  if (note.source === "Call" && !String(note.ref || "").trim()) missing.push("call REF");
  if (note.source === "Call" && (!note.call_start || !note.call_end)) missing.push("call start and end time");
  const preview = composeNote({ ...note, dos: mmdd(note.dos) || note.dos }, null, "");
  const add = async () => { setBusy(true); setErr(null); try { await rpc("notes.add", { claim_id: c.id, note }); toast("Note added."); setNote(blank()); onChanged && onChanged(); } catch (e) { setErr(e.message); } setBusy(false); };
  return (
    <div className="card tight stack" style={{ gap: 10 }}>
      <div className="row between"><div className="cv-sec" style={{ margin: 0 }}>📝 Note · saved as one cell in the standard format</div><span className="tiny muted">the SAAG entry is done from “Work this claim”</span></div>
      <NoteFieldsRow note={note} setN={setN} />
      <LimitsRow note={note} setN={setN} claim={c} />
      <PreCheck note={note} togglePre={togglePre} setN={setN} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr)", gap: 14 }}>
        <Field label="RCA / findings"><textarea className="textarea" value={note.findings} onChange={(e) => setN("findings")(e.target.value)} placeholder="What the payer or portal said, the root cause, and what happens next." /></Field>
        <Attachments plain claimId={c.id} files={files} onChanged={onChanged} />
      </div>
      <ErrorBox error={err} />
      <div className="wf-bar" style={{ position: "static", boxShadow: "none", padding: "8px 0 0", borderRadius: 0 }}>
        <span className="tiny muted b" style={{ whiteSpace: "nowrap" }}>ONE-CELL NOTE PREVIEW</span><div className="cell">{preview}</div>
        {missing.length > 0 && <span className="tiny" style={{ color: "var(--amber-ink)" }}>Still needed: {missing.join(", ")}.</span>}
        <button className="btn primary" disabled={busy || missing.length > 0} onClick={add}>{busy ? "Saving…" : "Add note"}</button>
      </div>
      <datalist id="saag-subs">{SAAG.subStatuses.map((x) => <option key={x} value={x} />)}</datalist>
    </div>
  );
}
/* The history tab on the right edge and the timeline panel it opens: newest first, grouped by day, each entry with its time. */
const HIST_FILTERS = [["all", "Everything"], ["work", "Work"], ["note", "Notes"], ["handoff", "Posting & submission"], ["file", "Files"], ["assign", "Assignments"], ["upload", "Uploads"]];
const HIST_GROUP = { work: "work", skip: "work", returned: "work", opened: "work", escalated: "work", answer: "note", note: "note", file: "file", assigned: "assign", unassigned: "assign", state: "assign", loaded: "upload", refreshed: "upload", file_work: "work", handoff_check: "handoff", handoff_rejected: "handoff", handoff_sent: "handoff", handoff_assigned: "handoff", handoff_done: "handoff", handoff_assist: "handoff", handoff_none: "handoff", handoff_back: "handoff", handoff_client: "handoff", handoff_resume: "handoff", handoff_client_sent: "handoff", handoff_pending: "handoff", handoff_inprocess: "handoff", handoff_other: "handoff", review_to_biller: "note", review_to_dept: "note" };
const CHANGE_LABEL = { state: "State", bucket: "Bucket", follow_up: "Follow-up", status: "SAAG status" };
const fmtTime = (ms) => new Date(Number(ms)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const dayKey = (ms) => { const d = new Date(Number(ms)); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const dayLabel = (k) => { const today = todayISO(); const d = new Date(k + "T00:00:00"); const txt = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }); return k === today ? "Today · " + txt : k === addDaysISO(today, -1) ? "Yesterday · " + txt : txt; };
const chgVal = (k, v) => (!v ? "–" : k === "follow_up" ? fmtDate(v) : k === "state" ? (STATE_META[v] ? STATE_META[v][1] : v) : v);
function Changes({ changes }) {
  const ks = Object.keys(changes || {});
  if (!ks.length) return null;
  return <div className="chg">{ks.map((k, i) => <span key={k}>{i ? " · " : ""}{CHANGE_LABEL[k] || k}: <s>{chgVal(k, changes[k][0])}</s> → <b>{chgVal(k, changes[k][1])}</b></span>)}</div>;
}
function NoteFieldList({ f }) {
  if (!f) return null;
  return <dl className="nf"><dt>DOS</dt><dd>{f.dos || "–"}</dd><dt>CLM#</dt><dd className="mono">{f.clm || "–"}</dd><dt>Denial</dt><dd>{f.denial || "–"}</dd>
    <dt>Source</dt><dd>{f.source || "–"}{f.ref ? " · REF " + f.ref : ""}</dd><dt>Pre call check</dt><dd>{[...(f.precheck || []), f.precheck_text].filter(Boolean).join("; ") || "–"}</dd>
    <dt>RCA / findings</dt><dd style={{ whiteSpace: "pre-wrap" }}>{f.findings || "–"}</dd>{f.action ? <><dt>Action</dt><dd><b>{f.action}</b></dd></> : null}</dl>;
}
function HistEvent({ it, onEdit, onFile }) {
  const D = (bg, ic) => <div className="dot" style={{ background: bg }}>{ic}</div>;
  const who = it.who ? " by " + it.who : "";
  let dot, title, body = null;
  switch (it.kind) {
    case "work": dot = D("#E0F7F4", "✔"); title = <>Worked{who}{it.escalated ? <span className="badge red" style={{ marginLeft: 6 }}>escalated</span> : null}</>;
      body = <>
        <div className="row mt8" style={{ gap: 4, flexWrap: "wrap" }}><span className="badge ink">{it.saag.status}</span>{it.saag.sub_status && <span className="badge gray">{it.saag.sub_status}</span>}<span className="badge">{it.saag.action}</span>{it.saag.bucket && <span className={"badge " + (it.saag.bucket === "Closed" ? "green" : "teal")}>{it.saag.bucket}</span>}{it.follow_up_on && <span className="badge amber">follow-up {fmtDate(it.follow_up_on)}</span>}</div>
        {it.fields && it.fields.findings != null ? <NoteFieldList f={it.fields} /> : <div className="x">{it.comment}</div>}
        <Changes changes={it.changes} />
        {it.edited_at ? <div className="m">edited {fmtWhen(it.edited_at)}</div> : null}
        {it.editable && onEdit && <button className="btn sm link" style={{ padding: 0, marginTop: 4 }} onClick={() => onEdit(it)}>Edit this entry</button>}</>; break;
    case "note": dot = D("#E4EEFA", "📝"); title = "Note" + who; body = it.fields ? <NoteFieldList f={it.fields} /> : <div className="x">{it.text}</div>; break;
    case "answer": dot = D("#FDEAEA", "⚑"); title = "Escalation answered" + who; body = <div className="x">{it.text}</div>; break;
    case "escalated": dot = D("#FDEAEA", "⚑"); title = "Escalated to the team lead"; break;
    case "skip": dot = D("#FDF2D9", "⏭"); title = "Skipped" + who; body = it.text ? <div className="x">{it.text}</div> : null; break;
    case "skipped": dot = D("#FDF2D9", "⏭"); title = "Skipped" + who; break;
    case "returned": dot = D("#EEF1F0", "↩"); title = "Put back on the list" + who; break;
    case "opened": dot = D("#FDF2D9", "✏️"); title = "Opened" + who; body = it.text ? <div className="m">{it.text}</div> : null; break;
    case "file": dot = D("#EEE7FB", "📎"); title = "File attached" + who; body = <div className="x"><button className="btn sm link" style={{ padding: 0 }} onClick={() => onFile && onFile(it.file)}>📄 {it.file.name}</button> <span className="tiny muted">· {fmtBytes(it.file.size)}</span></div>; break;
    case "assigned": dot = D("#E4EEFA", "👤"); title = "Assigned to " + (it.text || "someone"); body = <>{(it.who || (it.data && it.data.via)) && <div className="m">{it.who ? "by " + it.who : ""}{it.data && it.data.via ? (it.who ? " · " : "") + ({ smart: "Allocate", auto: "auto allocation", reassign: "reassigned", allocate: "Allocate" }[it.data.via] || it.data.via) : ""}</div>}{it.data && it.data.from ? <div className="chg">Assigned: <s>{it.data.from}</s> → <b>{it.text}</b></div> : null}</>; break;
    case "unassigned": dot = D("#EEF1F0", "👤"); title = "Unassigned" + (it.text ? " from " + it.text : "") + who; break;
    case "state": dot = D("#EEF1F0", "⇄"); title = "State changed" + who; body = <><Changes changes={it.changes} />{it.text ? <div className="m">{it.text}</div> : null}</>; break;
    case "loaded": dot = D("#EEF1F0", "⤴"); title = "Loaded from inventory"; body = <><div className="m">{[it.text, it.who ? "by " + it.who : ""].filter(Boolean).join(" · ")}</div>{it.data && it.data.file_status ? <div className="x">File said: {it.data.file_status}</div> : null}</>; break;
    case "priority": { const d = it.data || {}; dot = D("#EEE7FB", d.level === "low" ? "↓" : d.level ? "↑" : "⟲"); title = "Priority " + (d.level ? (PRIORITY_LEVELS_UI[d.level] || {}).label : "back to automatic") + who;
      body = <><div className="x"><b>{d.category}</b>{d.comment ? ": " + d.comment : ""}</div><div className="m">{d.from != null ? "score " + d.from + " → " + d.to : ""}{d.n > 1 ? " · with " + (d.n - 1) + " other claims" : ""}</div></>; break; }
    case "enriched": { const d = it.data || {}; dot = D("#E0F7F4", "＋"); title = "Details filled from a report" + who;
      body = <><div className="x">{(d.fields || []).map((f) => DETAIL_FIELD_LABEL[f] || f).concat(d.other ? ["other columns"] : []).join(", ")}</div><div className="m">{[it.text, d.purpose ? "why: " + d.purpose : ""].filter(Boolean).join(" · ")}</div></>; break; }
    case "file_work": { const d = it.data || {}; dot = D("#FDF2D9", "📄"); title = "Worked in the file" + (d.worked_by ? " by " + d.worked_by : "") + (d.worked_on ? " · " + fmtDate(d.worked_on) : "");
      body = <><div className="x">{[d.status, d.sub_status].filter(Boolean).join(" › ")}{d.action ? (d.status ? " › " : "") + d.action : ""}{d.comments ? <div style={{ marginTop: 4 }}>{d.comments}</div> : null}</div>
        <div className="m">{[it.text ? "from " + it.text : "", d.move_to ? "move to " + d.move_to : "", d.follow_up ? "follow-up " + fmtDate(d.follow_up) : "", d.balance != null ? "balance " + fmtMoney(d.balance, 2) : ""].filter(Boolean).join(" · ")}</div></>; break; }
    case "refreshed": dot = D("#EEF1F0", "⟳"); title = "Refreshed from inventory"; body = <><div className="m">{[it.text, it.who ? "by " + it.who : ""].filter(Boolean).join(" · ")}</div>{it.data && it.data.file_status ? <div className="x">File said: {it.data.file_status}{it.data.balance != null ? " · balance " + fmtMoney(it.data.balance, 2) : ""}</div> : null}<Changes changes={it.changes} /></>; break;
    case "handoff_sent": dot = D("#EEE7FB", "➜"); title = "Sent to " + (it.text || "the department") + who; body = it.data && it.data.due_at ? <div className="m">due {fmtWhen(it.data.due_at)} (the client's TAT)</div> : null; break;
    case "handoff_none": dot = D("#EEF1F0", "ⓘ"); title = (it.text || "Hand-off") + ": " + ({ client: "done by the client", biller: "done by the biller", unset: "nobody set for this client" }[it.data && it.data.mode] || "not sent"); break;
    case "handoff_assigned": dot = D("#EEE7FB", "👤"); title = (DEPT_NAME[it.data && it.data.dept] || "Hand-off") + " assigned to " + (it.text || "someone") + who; break;
    case "handoff_done": { const pr = (it.data && it.data.proof) || {}; const posting = it.data && it.data.dept === "posting";
      dot = D("#E3FBEF", "✓"); title = (posting ? "Payment posted" : it.data && it.data.dept === "subcheck" ? "Submission accepted by the payer" : "Submitted") + who; body = <><div className="x">{posting ? "Check / EFT " : "Batch / claim ID "}<b>{pr.ref}</b>{pr.date ? " · " + fmtDate(pr.date) : ""}{pr.amount != null ? " · " + fmtMoney(pr.amount, 2) : ""}{pr.mode ? " · " + pr.mode : ""}{it.data.note ? "\n" + it.data.note : ""}</div>{pr.files && pr.files.length ? <div className="m">📎 proof: {pr.files.join(", ")}</div> : null}<div className="m">{it.data.within_tat ? "within TAT" : "after the TAT"}</div></>; break; }
    case "handoff_check": dot = D("#E0F7F4", "⏱"); title = "48-hour recheck set for " + (it.text || "someone") + who; body = it.data && it.data.available_at ? <div className="m">check from {fmtWhen(it.data.available_at)} · due {fmtWhen(it.data.due_at)}</div> : null; break;
    case "handoff_rejected": dot = D("#FDEAEA", "✗"); title = "Submission rejected" + who; body = <><div className="x"><b>{it.data && it.data.reason}</b>{it.data && it.data.note ? ": " + it.data.note : ""}</div><div className="m">{it.data && it.data.resent ? "sent to " + (it.data.to === "Rejections" ? "the Rejections person (first priority)" : "the Submission team") + " to correct and resubmit" : "back on the biller's list"}</div></>; break;
    case "handoff_back": dot = D("#FFF3D6", "↩"); title = (it.text || "The department") + " needs assistance from AR" + who; body = <><div className="x"><b>{it.data && it.data.reason}</b>{it.data && it.data.note ? ": " + it.data.note : ""}</div><div className="m">on the biller's list today{it.data && it.data.within_tat === false ? " · after the 24h TAT" : ""}{it.data && it.data.returns ? " · returned " + it.data.returns + "×" : ""}{it.data && it.data.bounced ? " · escalated to the team lead" : ""}</div></>; break;
    case "handoff_client_sent": dot = D("#E4EEFA", "✉"); title = "Sent to the client for " + (it.text || "the department") + who; body = <><div className="x"><b>{it.data && it.data.how}</b>{it.data && it.data.reason ? " · " + it.data.reason : ""}{it.data && it.data.note ? ": " + it.data.note : ""}</div><div className="m">chased in 3 working days if the client has not answered</div></>; break;
    case "handoff_pending": dot = D("#EEF1F4", "…"); title = (it.text || "The department") + " · pending" + who; body = it.data && it.data.note ? <div className="x">{it.data.note}</div> : null; break;
    case "handoff_inprocess": dot = D("#E6F0FB", "…"); title = (it.text || "The department") + " · in process" + who; body = it.data && it.data.note ? <div className="x">{it.data.note}</div> : null; break;
    case "handoff_other": dot = D("#FDF0D7", "?"); title = (it.text || "The department") + " · other: " + ((it.data && it.data.reason) || "") + who; body = it.data && it.data.note ? <div className="x">{it.data.note}</div> : null; break;
    case "review_to_biller": case "review_to_dept": dot = D("#E3F4EF", "✓"); title = "Supervisor review · " + (it.kind === "review_to_dept" ? "returned to " : "given to ") + (it.text || "") + who;
      body = it.data ? <div className="x">{it.data.origin && it.data.origin.by ? <div className="m">{it.data.origin.how === "escalated" ? "Escalated by " : (it.data.origin.how.charAt(0).toUpperCase() + it.data.origin.how.slice(1)) + ": "}{it.data.origin.by}{it.data.origin.at ? " · " + fmtWhen(it.data.origin.at) : ""}{it.data.origin.reason ? " · " + it.data.origin.reason : ""}</div> : null}<div><b>Why it came:</b> {it.data.why}</div><div><b>Reviewed:</b> {it.data.reviewed}</div><div><b>Findings:</b> {it.data.findings}</div><div><b>Next action:</b> {it.data.next}</div></div> : null; break;
    case "handoff_client": dot = D("#FFF3D6", "⏸"); title = (it.text || "Department") + " needs assistance from client" + who; body = <><div className="x"><b>{it.data && it.data.reason}</b>{it.data && it.data.note ? ": " + it.data.note : ""}</div><div className="m">waiting on the client · the 24h clock keeps running</div></>; break;
    case "handoff_resume": dot = D("#E0F7F4", "▶"); title = "Client answered · back with " + (it.text || "the department") + who; body = <>{it.data && it.data.note ? <div className="x">{it.data.note}</div> : null}{it.data && it.data.due_at ? <div className="m">new due {fmtWhen(it.data.due_at)} (the client's TAT)</div> : null}</>; break;
    case "handoff_assist": dot = D("#FDEAEA", "⚑"); title = (it.text || "Department") + " needs assistance" + who; body = <><div className="x"><b>{it.data && it.data.reason}</b>{it.data && it.data.note ? ": " + it.data.note : ""}</div><div className="m">back on the biller's list · in the team lead's Needs attention</div></>; break;
    default: dot = D("#EEF1F0", "•"); title = it.kind + who; body = it.text ? <div className="x">{it.text}</div> : null;
  }
  return <div className="hev">{dot}<div className="r1"><div className="t">{title}</div><span className="tm">{fmtTime(it.at)}</span></div>{body}</div>;
}
function ClaimHistory({ claimId, claim, me, version }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [tick, setTick] = useState(0);
  const q = useRpc("claims.timeline", { id: claimId }, [claimId, version, tick]);
  const [edit, setEdit] = useState(null);
  const items = (q.data ? q.data.items : []).filter((it) => filter === "all" || HIST_GROUP[it.kind] === filter);
  const days = []; items.forEach((it) => { const k = dayKey(it.at); if (!days.length || days[days.length - 1].k !== k) days.push({ k, items: [] }); days[days.length - 1].items.push(it); });
  const openFile = async (f) => { try { const r = await rpc("attachments.get", { id: f.id }); const url = URL.createObjectURL(base64Blob(r.data, r.type)); const a = document.createElement("a"); a.href = url; a.download = r.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); } catch (e) { toast(e.message, "err"); } };
  const saveEdit = async (data) => { await rpc("notes.update", { id: edit.id, ...data }); toast("Entry updated."); setEdit(null); setTick((t) => t + 1); };
  const n = q.data ? q.data.items.length : 0;
  return (
    <>
      {!open && <button className="hist-tab" title="Everything that happened to this claim, with date and time" onClick={() => { setOpen(true); setTick((t) => t + 1); }}>🕘<span>CLAIM HISTORY</span><i>{n}</i></button>}
      {open && <div className="hist-shade" onClick={() => setOpen(false)} />}
      {open && (
        <div className="hist">
          <div className="hist-top">
            <div className="row between"><div><h2 style={{ margin: 0 }}>Claim history</h2><div className="sub">{[claim.claim_no || "No claim #", claim.patient, claim.payer].filter(Boolean).join(" · ")}</div></div><button className="btn sm" onClick={() => setOpen(false)}>✕</button></div>
            <div className="row mt8" style={{ gap: 5, flexWrap: "wrap" }}>{HIST_FILTERS.map(([k, l]) => <button key={k} className={"chip " + (filter === k ? "on" : "")} style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setFilter(k)}>{l}</button>)}</div>
          </div>
          <div className="hist-body">
            <ErrorBox error={q.error} />
            {q.loading && !q.data && <div className="mt"><Spinner /></div>}
            {q.data && !items.length && <div className="muted small mt">Nothing here yet.</div>}
            {days.map((d) => <div key={d.k}><div className="hist-day">{dayLabel(d.k)}</div><div className="hist-tl">{d.items.map((it, i) => <HistEvent key={i} it={it} onFile={openFile} onEdit={(x) => { setEdit(x); setOpen(false); }} />)}</div></div>)}
          </div>
        </div>
      )}
      {edit && (
        <Modal title="Edit this entry" sub={"Written " + fmtWhen(edit.at)} onClose={() => setEdit(null)} wide>
          <WorkForm claim={claim} compact initial={{ saag: edit.saag, note: edit.fields, follow_up_on: edit.follow_up_on }} buttons={[{ key: "save", label: "Save changes", primary: true }]} onSave={(data) => saveEdit(data)} onCancel={() => setEdit(null)} />
        </Modal>
      )}
    </>
  );
}
/* ---------- payment posting & submission hand-offs ---------- */
const DEPT_NAME = { ar: "AR follow-up", posting: "Payment Posting", submission: "Submission", subcheck: "Submission follow-up", rejection: "Rejections" };
const RESP_COLS_UI = { ar: ["ar_mode", "ar_lead", "ar_backup"], posting: ["posting_mode", "posting_lead", "posting_backup"], submission: ["submission_mode", "submission_lead", "submission_backup"], subcheck: ["submission_check_mode", "submission_check_person", null],
  rejection: ["rejection_mode", "rejection_lead", "rejection_backup"] };
const MODE_LABEL = { person: "A person from the roster", client: "Client does it", biller: "Biller does it", "": "Not set" };
const handoffToast = (h) => (!h ? "" : h.mode === "person" ? ` Sent to ${h.label}${h.to ? " (" + h.to + ")" : ""}.` : h.mode === "client" ? ` ${h.label} is done by the client for this project.` : h.mode === "biller" ? ` You do the ${h.label.toLowerCase()} for this project.` : ` No ${h.label.toLowerCase()} responsibility is set for this client yet: tell your team lead.`);
const fmtDue = (h) => { const ms = h.due_at - Date.now(); const a = Math.abs(ms); const t = a >= 86400000 ? Math.floor(a / 86400000) + "d " + Math.floor((a % 86400000) / 3600000) + "h" : Math.floor(a / 3600000) + "h " + Math.floor((a % 3600000) / 60000) + "m"; return ms < 0 ? "TAT missed · " + t : "due in " + t; };
/* Client profile: who does payment posting and submission for this client. */
const isSmeUI = (u) => /\bsme\b|subject matter/i.test((u && u.designation) || "");
/* Who else a client is shared with (crossover spans): chips with view / edit, and the share form for team leads and up. */
function AccessRow({ c, ctx, me, onSaved, dir }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [level, setLevel] = useState("view");
  const [busy, setBusy] = useState(false);
  const canShare = c.can_edit !== false && !isSmeUI(me);
  const rows = c.access || [];
  const opts = (dir && dir.length ? dir : ctx.users.filter((u) => u.active)).filter((u) => u.id !== me.id && !rows.some((r) => r.user_id === u.id))
    .map((u) => ({ id: u.id, label: u.name, sub: [u.designation, u.department].filter(Boolean).join(" · ") }));
  const add = async () => { if (!pick) return; setBusy(true); try { await rpc("clients.accessSave", { client_id: c.id, user_id: pick, level }); toast("Shared."); setPick(""); setOpen(false); onSaved && onSaved(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const rm = async (r) => { setBusy(true); try { await rpc("clients.accessRemove", { client_id: c.id, user_id: r.user_id }); toast("Access removed."); onSaved && onSaved(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  return (
    <div className="small mt8" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <b>Shared with:</b>
      {rows.map((r) => <span key={r.user_id} className="badge gray" title={"Shared by " + (r.granted_by_name || "?") + " · " + fmtWhen(r.at)}>{r.name} · {r.level === "edit" ? "can edit" : "view only"}{canShare && <button type="button" className="btn link sm" style={{ padding: "0 2px" }} disabled={busy} onClick={() => rm(r)}>×</button>}</span>)}
      {!rows.length && <span className="muted">nobody outside its own span</span>}
      {canShare && !open && <button className="btn sm" onClick={() => setOpen(true)} title="Give one person view-only or edit access to this client">+ Share this client</button>}
      {canShare && open && <>
        <span style={{ display: "inline-block", minWidth: 230 }}><Combo sm value={pick} onChange={setPick} placeholder="A biller, TL or manager…" options={opts} /></span>
        <select className="input sm" style={{ width: "auto" }} value={level} onChange={(e) => setLevel(e.target.value)}><option value="view">View only</option><option value="edit">Can edit</option></select>
        <button className="btn sm primary" disabled={busy || !pick} onClick={add}>Share</button>
        <button className="btn sm link" onClick={() => setOpen(false)}>cancel</button>
        <span className="tiny muted" style={{ flexBasis: "100%" }}>View only: they see this client's claims, dashboards and reports. Can edit: they can also upload, allocate and answer, like their own client.</span>
      </>}
    </div>
  );
}
function ResponsibilityRow({ c, dept, ctx, onSaved, me, readOnly }) {
  const [mc, lc, bc] = RESP_COLS_UI[dept];
  const check = dept === "subcheck";
  const mode = c[mc] || "", lead = c[lc] || "", backup = bc ? c[bc] || "" : "";
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({ mode, lead, backup });
  const [busy, setBusy] = useState(false);
  const deptRe = dept === "posting" ? /posting/i : dept === "ar" ? /^(ar|accounts)/i : check ? /^$/ : /submission/i;   // Rejections are usually Submission people
  const names = new Set((c.roster_names || []).map((n) => String(n).toLowerCase()));
  const onProject = (u) => (u.projects || []).some((p) => names.has(String(p.name).toLowerCase()));
  const suggested = ctx.users.filter((u) => u.active && deptRe.test(u.department || "") && u.role === "supervisor" && onProject(u));
  const people = [...ctx.users.filter((u) => u.active)].sort((a, b) => (deptRe.test(b.department || "") - deptRe.test(a.department || "")) || a.name.localeCompare(b.name));
  const opts = people.map((u) => ({ id: u.id, label: u.name + (me && u.id === me.id ? " (me)" : ""), sub: [u.designation, u.department, suggested.includes(u) ? "suggested" : ""].filter(Boolean).join(" · ") }));
  const nameOf = (id) => (ctx.users.find((u) => u.id === id) || {}).name || (c.resp_names && (id === lead ? c.resp_names[lc] : bc ? c.resp_names[bc] : "")) || "someone";
  const modeLabel = (m) => (check && m === "biller" ? "The biller who sent it" : check && m === "person" ? "A person (supervisor, biller or me)" : MODE_LABEL[m]);
  const save = async () => { setBusy(true); try { await rpc("clients.saveResponsibility", { client_id: c.id, dept, ...d }); toast(DEPT_NAME[dept] + " responsibility saved."); setOpen(false); onSaved && onSaved(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  return (
    <div className="small mt8">
      <b>{check ? "Submission follow-up (48 working hours after submitting)" : dept === "rejection" ? "Rejections (first priority)" : dept === "ar" ? "AR follow-up (accountable)" : DEPT_NAME[dept]}:</b> {mode === "person" ? <>{nameOf(lead)}{backup ? <span className="muted"> · backup {nameOf(backup)}</span> : null}</> : <span className={mode ? "" : "muted"}>{modeLabel(mode)}</span>}{" "}
      {!readOnly && <button className="btn link sm" onClick={() => { setOpen(!open); setD({ mode, lead: lead || (suggested[0] || {}).id || "", backup }); }}>{open ? "cancel" : mode ? "change" : "set"}</button>}
      {!mode && suggested.length > 0 && !open && <span className="tiny muted"> · roster suggests {suggested.map((u) => u.name).join(", ")}</span>}
      {open && (
        <div className="row mt8" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Combo sm width={230} clearable={false} value={d.mode} onChange={(v) => setD({ ...d, mode: v })} options={["person", "biller", "client", ""].map((m) => ({ id: m, label: m ? modeLabel(m) : "Not set" }))} />
          {d.mode === "person" && <Combo sm width={240} value={d.lead} onChange={(v) => setD({ ...d, lead: v })} placeholder="Responsible person…" options={opts} />}
          {d.mode === "person" && bc && <Combo sm width={220} value={d.backup} onChange={(v) => setD({ ...d, backup: v })} placeholder="Backup (optional)…" options={opts.filter((o) => o.id !== d.lead)} />}
          <button className="btn sm primary" disabled={busy || (d.mode === "person" && !d.lead)} onClick={save}>Save</button>
          <span className="tiny muted" style={{ flexBasis: "100%" }}>{check ? (d.mode === "person" || d.mode === "biller" ? "48 working hours after a claim is submitted, a recheck lands in this person's queue: Accepted by payer (final check done), or Rejected (to the Rejections person first, else the Submission team). The biller keeps the 15-day follow-up." : "Not set: the recheck goes to whoever submitted the claim, 48 working hours later. The biller keeps the 15-day follow-up.") : dept === "rejection" ? (d.mode === "person" ? "Rejected claims (a rejected recheck, or a biller's Claim Rejected entry that needs resubmitting) go to this person first, at the top of their list." : "Not set: rejected claims go to the Submission person.") : d.mode === "person" ? `Claims with a ${dept === "posting" ? "Need to Post / Posting Correction" : "resubmission or paper-claim"} action go to this person's Posting & submission queue (24 working hours).${dept === "posting" ? " The claim is closed for the biller." : ""}` : d.mode === "client" ? "Nothing is sent: the entry notes that the client does it." : d.mode === "biller" ? "Nothing is sent: the biller does it as part of their own work." : "Nothing is sent until this is set."}</span>
        </div>
      )}
    </div>
  );
}
/* The shared status on a claim, and (for the department) the actions. */
function HandoffCard({ handoffs, role, onChanged, compact }) {
  const [act, setAct] = useState(null);
  if (!handoffs || !handoffs.length) return null;
  const h = handoffs[0];
  const open = ["pending", "assigned", "client"].includes(h.status);
  const canClose = open && (role === "lead" || role === "member");
  return (
    <div className="card tight" style={{ borderLeft: "4px solid " + (h.status === "complete" ? "#12B886" : h.status === "assistance" || h.overdue ? "#A32D2D" : "#7C5CD6") }}>
      <div className="row between" style={{ gap: 8, flexWrap: "wrap" }}>
        <div className="small"><span className="cv-sec" style={{ display: "inline-flex", margin: 0 }}>{DEPT_NAME[h.dept]}</span>{" "}
          {h.status === "client" ? <><span className="badge amber">Waiting on client</span> <span className="muted">{h.reason} · asked {fmtWhen(h.paused_at)} · {h.due_at < Date.now() ? "past the TAT" : "due " + fmtWhen(h.due_at)}</span></>
            : h.status === "back" ? <><span className="badge amber">Needs assistance from AR</span> <span className="muted">{h.reason} · by {h.done_by_name} · {fmtWhen(h.done_at)}</span></>
            : open ? <><span className={"badge " + (h.overdue ? "red" : "purple")}>{h.status === "assigned" ? "assigned to " + (h.assigned_name || "") : "waiting for " + (h.lead_name || "the lead")}</span> <span className={h.overdue ? "b" : "muted"} style={h.overdue ? { color: "var(--red-ink)" } : undefined}>{fmtDue(h)}</span></>
            : h.status === "rejected" ? <><span className="badge red">Rejected</span> <span className="muted">{h.reason} · by {h.done_by_name} · {fmtWhen(h.done_at)}</span></>
            : h.status === "complete" ? <><span className="badge green">{h.dept === "posting" ? "Payment posted" : h.dept === "subcheck" ? "Accepted by payer" : "Submitted"}</span> <span className="muted">by {h.done_by_name} · {fmtWhen(h.done_at)} · {h.dept === "posting" ? "check / EFT" : "batch / claim ID"} <b>{h.proof.ref}</b>{h.proof.date ? " · " + fmtDate(h.proof.date) : ""}{h.proof.amount != null ? " · " + fmtMoney(h.proof.amount, 2) : ""}{h.proof.mode ? " · " + h.proof.mode : ""}{h.proof.files && h.proof.files.length ? " · 📎 " + h.proof.files.length + " proof file" + (h.proof.files.length > 1 ? "s" : "") : " · no proof file"}</span></>
            : <><span className="badge red">Needs assistance</span> <span className="muted">{h.reason} · by {h.done_by_name} · {fmtWhen(h.done_at)}</span></>}
          <span className="tiny muted"> · sent by {h.created_by_name} {fmtWhen(h.created_at)} ({h.saag_action})</span>
          {h.note && !open ? <div className="tiny mt8">{h.note}</div> : null}</div>
        {canClose && !compact && <HandoffActions h={h} canClose onOpen={null} onAct={(outcome) => setAct({ h, outcome })} />}
      </div>
      {act && <HandoffCloseModal act={act} onClose={() => setAct(null)} onDone={() => { setAct(null); onChanged && onChanged(); }} />}
    </div>
  );
}
// Need assistance from AR: what the department needs from the biller / AR.
const AR_REASONS_UI = { posting: ["No EOB / ERA attached", "Wrong EOB or wrong information from AR", "Amount mismatch", "Patient / account not found", "Payer not set up", "Duplicate payment", "Not ready to post", "Wrong department", "Other"],
  submission: ["Missing claim data", "Wrong information from AR", "No payer ID / address", "Authorization missing", "Duplicate claim", "Not ready to submit", "Wrong department", "Other"],
  subcheck: ["Payer has no record yet", "Cannot reach the payer / portal", "Other"] };
AR_REASONS_UI.rejection = AR_REASONS_UI.submission;
const CLIENT_REASONS_UI = { posting: ["Need EOB / ERA from the client", "Need payment / deposit details", "Need patient or account details", "Other"],
  submission: ["Need corrected demographics / insurance", "Need signature or documents", "Need authorization / referral", "Need coding clarification", "Other"] };
// What was wrong with a rejected claim (same list as REJECT_CODES in worker.js), for the rejection reports.
const REJECT_REASONS_UI = ["Subscriber / member ID invalid", "Patient name or DOB mismatch", "Payer ID or address invalid", "Rendering / billing NPI invalid or missing", "Taxonomy missing",
  "Diagnosis code invalid", "CPT or modifier invalid", "Place of service invalid", "Authorization / referral missing", "Duplicate claim", "Timely filing", "Coordination of benefits", "Other"];
/* Optional proof files for a hand-off step; they are attached to the claim when the step is saved. */
function ProofFiles({ files, setFiles, why }) {
  const input = useRef(null);
  const pick = (fl) => {
    const add = [...(fl || [])].filter((f) => { if (f.size > ATTACH_MAX) { toast(f.name + " is larger than " + fmtBytes(ATTACH_MAX) + ".", "err"); return false; } return true; });
    if (input.current) input.current.value = "";
    if (add.length) setFiles([...files, ...add].slice(0, 10));
  };
  return (
    <div className="card tight" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files); }}>
      <div className="row between">
        <div className="b small">Attach proof <span className="tiny muted" style={{ fontWeight: 400 }}>(optional)</span></div>
        <button type="button" className="btn sm" onClick={() => input.current && input.current.click()}>📎 Add file</button>
        <input ref={input} type="file" multiple style={{ display: "none" }} onChange={(e) => pick(e.target.files)} />
      </div>
      <div className="tiny muted mt8">Why: {why}</div>
      {files.map((f, i) => (
        <div key={i} className="row between mt8" style={{ gap: 6 }}>
          <span className="small" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 {f.name} <span className="tiny muted">· {fmtBytes(f.size)}</span></span>
          <button type="button" className="btn sm link" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
    </div>
  );
}
const PROOF_WHY = {
  posting: "a screenshot of the posted payment (or the EOB / ERA page) lets posting QA audit it and lets the biller see the payment without asking you.",
  submission: "the clearinghouse acceptance / batch report or portal screenshot shows the claim really went out, so the biller's 15-day follow-up starts from proof.",
  subcheck: "the payer portal screenshot or acknowledgement shows the payer has the claim, in case it is later denied for timely filing.",
};
/* The 24-hour clock on a hand-off: time left, past the TAT, paused while waiting on the client, or (the follow-up check)
   when the recheck opens, 48 working hours after submitting. */
const durText = (ms) => { const a = Math.abs(ms); return a >= 86400000 ? Math.floor(a / 86400000) + "d " + Math.floor((a % 86400000) / 3600000) + "h" : Math.floor(a / 3600000) + "h " + Math.floor((a % 3600000) / 60000) + "m"; };
function TatTag({ h }) {
  const now = Date.now();
  if (h.dept === "subcheck" && h.available_at && now < h.available_at) return <div><span className="badge gray">Recheck from {fmtWhen(h.available_at)}</span><div className="tiny muted">48 working hours after submitting</div></div>;
  const start = h.dept === "subcheck" && h.available_at ? h.available_at : h.created_at;
  const left = h.due_at - now, used = Math.max(0, Math.min(100, (100 * (now - start)) / Math.max(1, h.due_at - start)));
  const tone = left < 0 ? "red" : used > 75 ? "amber" : "teal";
  return (
    <div>
      {h.chase ? <div><span className="badge red" style={{ marginBottom: 4 }}>Chase the client</span></div> : h.status === "client" ? <div><span className="badge amber" style={{ marginBottom: 4 }}>Waiting on client</span></div> : null}
      {h.due_soon && <div><span className="badge amber" style={{ marginBottom: 4 }}>⚠ under 4 hours left</span></div>}
      <span className={"badge " + tone}>{left < 0 ? "Past the TAT by " + durText(left) : (h.dept === "subcheck" ? "Recheck now · " : "TAT · ") + durText(left) + " left"}</span>
      <div className="tatline"><i style={{ width: (left < 0 ? 100 : used) + "%", background: "var(--" + (tone === "teal" ? "teal" : tone === "amber" ? "amber" : "red") + ")" }} /></div>
      <div className="tiny muted">{h.status === "client" ? "asked the client " + fmtWhen(h.paused_at) : "sent " + fmtWhen(h.created_at)} · due {fmtWhen(h.due_at)}</div>
    </div>
  );
}
/* What the department can do with a claim it was sent: Complete up front, the other choices under More. Every choice opens a box for a comment. */
function HandoffActions({ h, canClose, onOpen, onAct }) {
  const [more, setMore] = useState(false);
  useEffect(() => { if (!more) return; const close = () => setMore(false); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, [more]);
  const main = !canClose ? null : h.status === "client" ? ["resume", "▶ Client answered", "primary"] : h.dept === "subcheck" ? ["complete", "✓ Completed · accepted", "primary"] : ["complete", "✓ Completed", "primary"];
  const rest = !canClose ? [] : h.status === "client" ? [["complete", "✓ Completed"], ["inprocess", "In process"], ["pending", "Pending (add a comment)"], ["back", "Need assistance from AR"], ["other", "Other (with a reason)"]]
    : h.dept === "subcheck" ? [["rejected", "✗ Rejected"], ["inprocess", "In process"], ["pending", "Pending (add a comment)"], ["back", "Need assistance from AR"], ["other", "Other (with a reason)"]]
    : [["inprocess", "In process"], ["pending", "Pending (add a comment)"], ["back", "Need assistance from AR"], ["client", "Need assistance from client"], ["other", "Other (with a reason)"]];
  return (
    <div className="ho-acts">
      {onOpen && <button className="btn sm" onClick={onOpen}>Open claim</button>}
      {main && <button className={"btn sm " + main[2]} onClick={() => onAct(main[0])}>{main[1]}</button>}
      {rest.length > 0 && <span style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button className="btn sm" onClick={() => setMore(!more)}>More ▾</button>
        {more && <div className="menu" style={{ top: 34, minWidth: 210 }}>{rest.map(([o, l]) => <button key={o} onClick={() => { setMore(false); onAct(o); }}>{l}</button>)}</div>}
      </span>}
    </div>
  );
}
function HandoffCloseModal({ act, onClose, onDone }) {
  const { h, outcome } = act;
  const [p, setP] = useState({ date: todayISO(), ref: "", amount: "", mode: "", code: "" });
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [files, setFiles] = useState([]);
  const posting = h.dept === "posting", check = h.dept === "subcheck";
  const ok = outcome === "complete" ? p.date && (check || p.ref.trim()) && (h.dept !== "rejection" || p.code) : outcome === "resume" || outcome === "inprocess" ? true : outcome === "pending" ? note.trim().length >= 8 : outcome === "other" ? reason.trim().length >= 3 && note.trim().length >= 8 : reason && note.trim().length >= 8;
  const done = { complete: check ? "Completed: accepted by the payer, final check done." : posting ? "Completed: payment posted." : "Completed: submitted, back to the biller with a 15-day follow-up; recheck in 48 working hours.", rejected: "Rejected: sent to the Rejections person (or the Submission team) to correct and resubmit.",
    assistance: "Sent to AR for assistance.", back: "Sent to AR for assistance: on the biller's list today with your comment.", client: "Sent to the team lead to ask the client.", resume: "Back in your open list, same due time.", pending: "Pending: comment saved.", inprocess: "In process: saved.", other: "Other: saved with your reason." };
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const names = [];
      if (outcome === "complete") for (const f of files) { await rpc("attachments.add", { claim_id: h.claim_id, name: f.name, type: f.type, data: await fileToBase64(f) }); names.push(f.name); }
      await rpc("handoffs.close", { id: h.id, outcome, proof: { ...p, files: names }, reason, note });
      toast(done[outcome] + (names.length ? " Proof attached to the claim." : "")); onDone();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  if (outcome === "back" || outcome === "client" || outcome === "resume" || outcome === "pending" || outcome === "inprocess" || outcome === "other") {
    const reasons = outcome === "back" ? AR_REASONS_UI[h.dept] || AR_REASONS_UI.submission : CLIENT_REASONS_UI[posting ? "posting" : "submission"];
    const title = { back: "Need assistance from AR", client: "Need assistance from client", resume: "Client answered", pending: "Pending", inprocess: "In process", other: "Other" }[outcome];
    const help = { back: "The claim goes back on the biller's list today with your reason and comment. If it comes back to AR a third time, their team lead is told too.",
      pending: "It stays on your list with this comment, so anyone can see where it stands. The TAT keeps running.",
      inprocess: "You are working on it now. It stays on your list marked In process; the TAT keeps running.",
      other: "Anything that is not one of the other choices. It stays on your list with your reason and comment; the TAT keeps running.",
      client: "The claim stays with " + DEPT_NAME[h.dept] + " (In process for AR) and shows under Waiting on client. The TAT keeps running: chase the client so it is finished on time.",
      resume: "The claim goes back to your open list with the same due time." }[outcome];
    return (
      <Modal title={title + " · " + DEPT_NAME[h.dept]} sub={[h.claim_no || "No claim #", h.patient, h.payer].filter(Boolean).join(" · ")} onClose={onClose} narrow
        footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" disabled={busy || !ok} onClick={go}>{busy ? "Saving…" : title}</button></>}>
        <div className="stack">
          {outcome === "other" && <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Waiting for the clearinghouse to come back up" autoFocus /></Field>}
          {outcome !== "resume" && outcome !== "pending" && outcome !== "inprocess" && outcome !== "other" && <Field label={outcome === "back" ? "What is needed from AR" : "What is needed from the client"}><Combo value={reason} onChange={setReason} placeholder="Pick…" options={reasons.map((x) => ({ id: x, label: x }))} /></Field>}
          <Field label={outcome === "resume" || outcome === "inprocess" ? "Comment (optional)" : "Comment"} hint={outcome === "resume" || outcome === "inprocess" ? "" : "At least a few words"}><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} autoFocus={outcome !== "other"}
            placeholder={outcome === "back" ? "What AR should do or fix before sending it again." : outcome === "client" ? "What is needed from the client, so the team lead can send it." : outcome === "pending" || outcome === "other" ? "Where it stands, e.g. posted 2 of 3 lines, waiting for the batch to close." : outcome === "inprocess" ? "Optional: what you are doing now." : "What the client sent or said."} /></Field>
          <div className="tiny muted">{help}</div>
          <ErrorBox error={err} />
        </div>
      </Modal>
    );
  }
  if (check && outcome !== "assistance") return (
    <Modal title={(outcome === "complete" ? "Accepted by payer · " : "Rejected · ") + "Submission follow-up"} sub={[h.claim_no || "No claim #", h.patient, h.payer].filter(Boolean).join(" · ")} onClose={onClose} narrow
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className={"btn " + (outcome === "complete" ? "primary" : "danger")} disabled={busy || !ok} onClick={go}>{busy ? "Saving…" : outcome === "complete" ? "Mark accepted" : "Send back to Submission"}</button></>}>
      <div className="stack">
        {outcome === "complete" ? <div className="grid g2">
          <Field label="Accepted on"><input className="input" type="date" value={p.date} max={todayISO()} onChange={(e) => setP({ ...p, date: e.target.value })} /></Field>
          <Field label="Payer claim # / reference (optional)"><input className="input mono" value={p.ref} onChange={(e) => setP({ ...p, ref: e.target.value })} autoFocus /></Field>
        </div> : <Field label="Rejection code (what was wrong)"><Combo value={reason} onChange={setReason} placeholder="Pick the code…" options={REJECT_REASONS_UI.map((x) => ({ id: x, label: x }))} /></Field>}
        <Field label={outcome === "complete" ? "Note (optional)" : "What was rejected"}><textarea className="textarea" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={outcome === "complete" ? "" : "Rejection message, what must be corrected before resubmitting."} /></Field>
        {outcome === "complete" && <ProofFiles files={files} setFiles={setFiles} why={PROOF_WHY.subcheck} />}
        <div className="tiny muted">{outcome === "complete" ? "The claim shows Submission accepted; the biller still follows up on payment after 15 days." : "The claim goes straight back to the Submission team's queue to correct and resubmit, within the client's TAT."}</div>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
  return (
    <Modal title={"Completed · " + DEPT_NAME[h.dept]} sub={[h.claim_no || "No claim #", h.patient, h.payer].filter(Boolean).join(" · ")} onClose={onClose} narrow
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" disabled={busy || !ok} onClick={go}>{busy ? "Saving…" : "Mark completed"}</button></>}>
      <div className="stack">
        <>
          <div className="grid g2">
            <Field label={posting ? "Posted date" : "Submitted date"}><input className="input" type="date" value={p.date} max={todayISO()} onChange={(e) => setP({ ...p, date: e.target.value })} /></Field>
            <Field label={posting ? "Check / EFT number" : "Batch or claim ID"}><input className="input mono" value={p.ref} onChange={(e) => setP({ ...p, ref: e.target.value })} autoFocus /></Field>
            {posting ? <Field label="Amount posted (optional)"><input className="input" type="number" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></Field>
              : <Field label="Mode (optional)"><Combo value={p.mode} onChange={(v) => setP({ ...p, mode: v })} placeholder="Pick…" options={["Electronic", "Paper", "Portal"].map((x) => ({ id: x, label: x }))} /></Field>}
            {h.dept === "rejection" && <Field label="Rejection code (what was wrong)"><Combo value={p.code} onChange={(v) => setP({ ...p, code: v })} placeholder="Pick the code…" options={REJECT_REASONS_UI.map((x) => ({ id: x, label: x }))} /></Field>}
          </div>
          <Field label="Comment (optional)"><textarea className="textarea" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything AR or QA should know about this one." /></Field>
          <ProofFiles files={files} setFiles={setFiles} why={PROOF_WHY[h.dept] || PROOF_WHY.submission} />
          <div className="tiny muted">{posting ? "The claim shows Payment posted and closes for AR; posting QA audits it later." : "The claim goes back to the biller with a 15-day follow-up, and a recheck (accepted or rejected?) opens 48 working hours from now."}</div>
        </>
        <ErrorBox error={err} />
      </div>
    </Modal>
  );
}
const DESK_TEXT = {
  both: ["Posting & submission", "Claims billers send you to post (Need to Post / Posting Correction) or to submit (resubmissions, corrected and paper claims). Mark each one Complete with its details, or ask for assistance."],
  posting: ["Payment posting", "Claims billers send you to post (their SAAG action Need to Post or Posting Correction). Post each one, then mark it Complete with the check / EFT details, or ask for assistance."],
  submission: ["Submission", "Claims billers send you to submit (resubmissions, corrected and paper claims). Submit each one, then mark it Complete with the batch / claim ID, or ask for assistance."],
};
function HandoffsView({ ctx, me, refreshHandoffs, handoffs, params }) {
  const desk = deskOf(me, handoffs);
  const hd = (handoffs && handoffs.depts) || [];
  const mine = desk === "submission" && (hd.includes("subcheck") || hd.includes("rejection")) ? ["submission", ...hd.filter((x) => x === "subcheck" || x === "rejection")] : null;
  const [dept, setDept] = useState(desk === "posting" ? "posting" : desk === "submission" && !mine ? "submission" : "");
  const [view, setView] = useState("open");
  // which client, and when the claim was sent to the desk (the same day the AR biller worked it)
  const [clientId, setClientId] = useState((params && params.client_id) || "");
  const [dr, setDr] = useState(() => ({ ...newRange("all"), key: "all" }));
  const span = rangeSpan(dr);
  const q = useRpc("handoffs.list", { dept: dept || undefined, view, client_id: clientId || undefined, from_ms: span ? dayBounds(span[0])[0] : undefined, to_ms: span ? dayBounds(span[1])[1] : undefined },
    [dept, view, clientId, span && span[0], span && span[1]]);
  // A new hand-off (the desk count changed): the list refreshes by itself.
  const deskN = handoffs ? handoffs.n : null, firstN = useRef(true);
  useEffect(() => { if (firstN.current) { firstN.current = false; return; } q.reload(); }, [deskN]);
  const [open, setOpen] = useState(null);
  const [act, setAct] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = q.data ? q.data.rows : [];
  const st = (q.data && q.data.stats) || {};
  const sort = useTableSort("due_at", "asc");
  const shown = sort.sortRows(rows, { due_at: (h) => (["pending", "assigned"].includes(h.status) ? h.due_at : h.done_at) });
  const changed = () => { q.reload(); refreshHandoffs && refreshHandoffs(); };
  const assign = async (h, uid) => { if (!uid) return; setBusy(true); try { await rpc("handoffs.assign", { id: h.id, user_id: uid }); toast("Assigned."); changed(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const team = (d) => ctx.users.filter((u) => u.active && (d === "posting" ? /posting/i : /submission/i).test(u.department || ""));
  const met = st.done_n ? Math.round((st.met || 0) / st.done_n * 100) : null;
  return (
    <div className="stack">
      {desk ? <div><h1>{DESK_TEXT[desk][0]}</h1><div className="sub">{DESK_TEXT[desk][1]} Each client's TAT (working hours) is set on its profile.</div></div> : <div><h1>Payment posting & submission</h1><div className="sub">Claims sent by billers through their SAAG action (Need to Post / Posting Correction → Payment Posting; resubmission and paper claims → Submission). Each client's TAT (working hours, set on its profile) to complete each one or ask for assistance; Saturday and Sunday do not count.</div></div>}
      <div className="grid g5">
        <Kpi label="Open" value={fmtInt(st.open_n || 0)} sub={st.rejection_n ? st.rejection_n + " rejection" + (st.rejection_n === 1 ? "" : "s") + " first" : "within each client's TAT"} tone="accent" />
        <Kpi label="Past TAT" value={fmtInt(st.overdue || 0)} tone={st.overdue ? "bad" : ""} sub="answer these first" />
        <Kpi label="Done · 30 days" value={fmtInt(st.done_n || 0)} tone="good" />
        <Kpi label="Within TAT" value={met == null ? "–" : met + "%"} sub="of those done in 30 days" />
        <Kpi label="Waiting on client" value={fmtInt(st.client_n || 0)} sub="TAT clock still running" tone={st.client_n ? "warn" : ""} />
      </div>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        {!desk || desk === "both" ? <div className="row" style={{ gap: 5 }}>{[["", "Both"], ["posting", "Payment posting"], ["submission", "Submission"]].map(([k, l]) => <button key={k} className={"chip " + (dept === k ? "on" : "")} onClick={() => setDept(k)}>{l}</button>)}</div>
          : mine ? <div className="row" style={{ gap: 5 }}>{[["", "All mine"], ...mine.map((k) => [k, DEPT_NAME[k]])].map(([k, l]) => <button key={k} className={"chip " + (dept === k ? "on" : "")} onClick={() => setDept(k)}>{l}</button>)}</div> : <span />}
        <div className="row" style={{ gap: 5 }}>{[["open", "Open"], ["mine", "Assigned to me"], ["client", "Waiting on client" + (st.client_n ? " " + st.client_n : "")], ["done", "Completed"], ["assist", "Assistance from AR"]].map(([k, l]) => <button key={k} className={"chip " + (view === k ? "on" : "")} onClick={() => setView(k)}>{l}</button>)}</div>
      </div>
      <div className="row desk-filters" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ minWidth: 240 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} allowAll /></div>
        <DateRange value={dr} onChange={setDr} allowAll label="Sent to the desk" />
        {(clientId || span) && <button className="btn sm link" onClick={() => { setClientId(""); setDr({ ...newRange("all"), key: "all" }); }}>Clear filters</button>}
        <span className="tiny muted" style={{ marginLeft: "auto", maxWidth: 300 }}>The date a claim was sent here is the day the AR biller saved the entry that sent it. The counts above follow these filters.</span>
      </div>
      {(st.recheck_now_n > 0 || st.due_soon_n > 0 || st.chase_n > 0) && <div className="row" style={{ gap: 8 }}>
        {st.recheck_now_n > 0 && <div className="alert info row between" style={{ flex: 1 }}><span><b>{st.recheck_now_n} recheck{st.recheck_now_n === 1 ? "" : "s"} due now:</b> was the submission accepted or rejected?</span><button className="btn sm" onClick={() => { setDept("subcheck"); setView("open"); }}>Show rechecks</button></div>}
        {st.due_soon_n > 0 && <div className="alert warn" style={{ flex: 1 }}><b>{st.due_soon_n} under 4 hours left</b> on the TAT: they are at the top of Open.</div>}
        {st.chase_n > 0 && <div className="alert warn row between" style={{ flex: 1 }}><span><b>{st.chase_n} to chase:</b> the client has not answered in 3 working days.</span><button className="btn sm" onClick={() => setView("open")}>Show</button></div>}
      </div>}
      <div className="card tight">
        <ErrorBox error={q.error} />
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap"><table className="t"><thead><tr>{sort.Th("due_at", view === "open" || view === "mine" ? "TAT" : view === "client" ? "Waiting since" : "Done")}{sort.Th("dept", "Department")}{sort.Th("claim_no", "Claim #")}{sort.Th("patient", "Patient")}{sort.Th("client_name", "Client")}{sort.Th("payer", "Payer")}{sort.Th("balance", "Balance", "r")}{sort.Th("created_by_name", "Sent by")}{sort.Th("assigned_name", "Assigned to")}<th></th></tr></thead>
          <tbody>{shown.map((h) => { const isOpen = ["pending", "assigned", "client"].includes(h.status); return (
            <tr key={h.id} className={h.overdue ? "tat-missed" : ""}>
              <td style={{ minWidth: 190 }}>{isOpen ? <TatTag h={h} /> : <><span className={"badge " + (h.status === "complete" ? "green" : h.status === "back" ? "amber" : "red")}>{h.status === "complete" ? (h.dept === "posting" ? "completed · posted" : h.dept === "subcheck" ? "completed · accepted" : "completed · submitted") : h.status === "rejected" ? "rejected" : "assistance from AR"}</span><div className="tiny muted">{fmtWhen(h.done_at)}{h.done_at && h.due_at ? (h.done_at <= h.due_at ? " · within TAT" : " · after TAT") : ""}</div></>}</td>
              <td><span className={"badge " + (h.dept === "posting" ? "purple" : h.dept === "subcheck" ? "teal" : h.dept === "rejection" ? "red" : "blue")}>{DEPT_NAME[h.dept]}</span>{h.dept === "rejection" && isOpen ? <div className="tiny b" style={{ color: "var(--red-ink)" }}>first priority</div> : h.dept === "submission" && /^Rejected/.test(h.saag_action) ? <div className="tiny" style={{ color: "var(--red-ink)" }}>resubmit</div> : null}
                {h.returns > 0 && <div><span className={"badge " + (h.returns >= 3 ? "red" : "amber")} style={{ marginTop: 3 }} title="Times this claim came back to AR from Posting, Submission or Rejections">Returned {h.returns}×</span></div>}
                {h.status === "client" && <div className="tiny" style={{ marginTop: 3, maxWidth: 230 }}>{h.client_sent_at ? <span className="muted">Sent to client by {h.client_sent_by_name} · {fmtWhen(h.client_sent_at)} · {h.client_sent_how}</span> : <span style={{ color: "var(--amber-ink)" }}>Not sent to the client yet (AR team lead)</span>}</div>}
                {h.pending_at && isOpen && h.status !== "client" ? <div style={{ marginTop: 3 }}><span className={"badge " + (h.desk_state === "in_process" ? "blue" : h.desk_state === "other" ? "amber" : "gray")}>{h.desk_state === "in_process" ? "In process" : h.desk_state === "other" ? "Other" + (h.reason ? ": " + h.reason : "") : "Pending"}</span> <span className="tiny muted">{h.pending_by_name} · {fmtWhen(h.pending_at)}</span></div> : null}
                {h.note && (isOpen || h.status === "back" || h.status === "assistance") ? <div className="tiny muted" style={{ maxWidth: 220, marginTop: 3 }} title={h.note}>“{h.note.length > 90 ? h.note.slice(0, 90) + "…" : h.note}”</div> : null}</td>
              <td className="mono small">{h.claim_no || "–"}</td><td>{h.patient}</td><td className="small">{h.client_name}{h.location_name ? " · " + h.location_name : ""}</td><td className="small">{h.payer}</td><td className="num">{fmtMoney(h.balance)}</td>
              <td className="small">{h.created_by_name}<div className="tiny muted">{h.saag_action}</div></td>
              <td className="small">{isOpen && h.can_assign ? <Combo sm width={170} value={h.assigned_to || ""} onChange={(v) => assign(h, v)} placeholder="Assign to team…" disabled={busy}
                  options={[...team(h.dept), ...ctx.users.filter((u) => u.id === me.id)].filter((u, i, a) => a.findIndex((x) => x.id === u.id) === i).map((u) => ({ id: u.id, label: u.id === me.id ? u.name + " (me)" : u.name }))} />
                : h.assigned_name || (isOpen ? <span className="muted">with {h.lead_name}</span> : h.done_by_name)}
                {!isOpen && h.status === "complete" && <div className="tiny muted">{h.proof.ref}{h.proof.date ? " · " + fmtDate(h.proof.date) : ""}{h.proof.files && h.proof.files.length ? " · 📎 proof" : ""}</div>}
                {!isOpen && (h.status === "assistance" || h.status === "rejected") && <div className="tiny" style={{ color: "var(--red-ink)" }}>{h.reason}</div>}</td>
              <td className="r"><HandoffActions h={h} canClose={isOpen && h.can_close} onOpen={() => setOpen(h.claim_id)} onAct={(outcome) => setAct({ h, outcome })} /></td>
            </tr>); })}
            {q.data && !rows.length && <tr><td colSpan={10}><Empty>{view === "open" ? "Nothing waiting. Claims arrive here when a biller saves a posting or submission action on a client that has a person set for it (Clients & locations)." : "Nothing here."}</Empty></td></tr>}</tbody></table></div>
      </div>
      {act && <HandoffCloseModal act={act} onClose={() => setAct(null)} onDone={() => { setAct(null); changed(); }} />}
      {open && <ClaimDrawer id={open} ctx={ctx} me={me} onClose={() => setOpen(null)} onChanged={changed} />}
    </div>
  );
}
/* ---------- claim detail drawer (supervisor and history views) ---------- */
function ClaimDrawer({ id, ctx, me, onClose, onChanged }) {
  const q = useRpc("claims.get", { id }, [id]);
  const [user, setUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [ver, setVer] = useState(0);
  const [patientOf, setPatientOf] = useState(null);
  const c = q.data && q.data.claim;
  const changed = () => { q.reload(); setVer((v) => v + 1); onChanged && onChanged(); };
  const act = async (label, fn) => { setBusy(true); try { await fn(); toast(label); changed(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const sup = me.role === "supervisor";
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide" style={{ maxWidth: 1240, background: "var(--card2)", position: "relative" }}>
        <ErrorBox error={q.error} />
        {!c && !q.error && <Spinner />}
        {c && (
          <div className="stack" style={{ gap: 14, paddingRight: 30 }}>
            <ClaimHeader c={c}><button className="btn sm" onClick={() => setPatientOf(c.id)}>All claims of this patient</button><button className="btn sm" onClick={onClose}>Close</button></ClaimHeader>
            <ClaimInfo c={c} siblings={q.data.siblings} />
            <HandoffCard handoffs={q.data.handoffs} role={q.data.handoff_role} onChanged={changed} />
            {sup && !q.data.handoff_role && (
              <div className="card tight row" style={{ gap: 8, flexWrap: "wrap" }}>
                <span className="cv-sec" style={{ margin: 0 }}>Team lead actions</span>
                <Combo sm width={220} value={user} onChange={setUser} placeholder="Assign to…" options={ctx.users.filter((u) => u.active).map((u) => ({ id: u.id, label: u.name, sub: u.designation || undefined }))} />
                <button className="btn sm primary" disabled={!user || busy} onClick={() => act("Assigned.", () => rpc("alloc.reassign", { ids: [id], user_id: user }))}>Assign</button>
                {(c.state === "assigned" || c.state === "in_progress") && <button className="btn sm" disabled={busy} onClick={() => act("Unassigned.", () => rpc("alloc.unassign", { ids: [id] }))}>Unassign</button>}
                {(c.state === "closed" || c.state === "excluded" || c.state === "completed") && <button className="btn sm" disabled={busy} onClick={() => act("Reopened.", () => rpc("claims.setState", { ids: [id], state: "open" }))}>Reopen</button>}
                {c.state !== "closed" && <button className="btn sm danger" disabled={busy} onClick={() => act("Closed.", () => rpc("claims.setState", { ids: [id], state: "closed" }))}>Close</button>}
                {c.state !== "excluded" && c.state !== "closed" && <button className="btn sm" disabled={busy} onClick={() => act("Excluded.", () => rpc("claims.setState", { ids: [id], state: "excluded" }))}>Exclude</button>}
              </div>
            )}
            <Suggestions claim={c} subStatus={c.last_sub_status} />
            {(c.mine || (sup && !q.data.handoff_role)) && <div className="card stack" style={{ paddingBottom: 0 }}>
              <div className="row between"><h2 style={{ margin: 0 }}>Work this claim</h2><span className="tiny muted">Save entry records the SAAG and the note; Add as note keeps just the note (for example on a closed claim)</span></div>
              <WorkForm key={"wf" + ver} claim={c}
                newFiles={(q.data.attachments || []).filter((a) => a.created_at > Math.max(0, ...q.data.notes.filter((n) => n.kind === "work").map((n) => n.created_at))).length}
                attachments={<Attachments plain claimId={c.id} files={q.data.attachments} onChanged={changed} />}
                buttons={[{ key: "note", label: "Add as note (no SAAG)", noSaag: true, title: "Only the note: DOS, CLM#, denial, source, pre call check, RCA and action" }, { key: "save", label: "Save entry", primary: true }]}
                onSave={async (data, key) => {
                  if (key === "note") { await rpc("notes.add", { claim_id: c.id, note: data.note }); toast("Note added."); }
                  else { const r = await rpc("queue.complete", { id: c.id, ...data }); toast((r.closed ? "Saved. Claim closed." : `Saved. Follow-up on ${fmtDate(r.follow_up_on)}.`) + handoffToast(r.handoff)); }
                  changed();
                }} />
            </div>}
            {q.data.handoff_role && !c.mine && <NoteForm c={c} files={q.data.attachments} onChanged={changed} />}
            <Siblings rows={q.data.siblings} users={ctx.users} meId={me.id} />
            <ClaimHistory claimId={c.id} claim={c} me={me} version={ver} />
          </div>
        )}
      </div>
      {patientOf && <PatientModal id={patientOf} ctx={ctx} me={me} onClose={() => setPatientOf(null)} onOpenClaim={() => {}} />}
    </div>
  );
}
function ClaimFacts({ c }) {
  const raw = c.raw || {};
  const shown = new Set(["claim_no", "account_no", "patient", "payer", "dos", "cpt", "provider", "balance", "billed"]);
  /* Compact by default: the file's status line only; "Full claim details" expands comments, every file column and the service lines. */
  const [more, setMore] = useState(false);
  return (
    <div className="stack">
      <LatestWork c={c} />
      <div className="card tight">
        <div className="row between top">
          <div className="claim-head"><span className="no">{c.claim_no || "No claim #"}</span><span className="muted">{c.account_no ? "Acct " + c.account_no : ""}</span></div>
          <div className="row" style={{ gap: 6 }}><StateBadge state={c.state} /><TierBadge tier={c.tier} /><ClassBadge cls={c.status_class} /><KindBadge claim={c} />{c.escalated ? <span className="badge red">escalated</span> : null}</div>
        </div>
        <dl className="kv mt">
          <dt>Patient</dt><dd><b>{c.patient || "–"}</b></dd>
          <dt>Payer</dt><dd>{c.payer || "–"}</dd>
          <dt>Date of service</dt><dd>{fmtDate(c.dos)} {c.age_days != null && <span className="muted">· {c.age_days} days · {c.bucket}</span>}</dd>
          <dt>Balance</dt><dd><b className="mono">{fmtMoney(c.balance, 2)}</b>{c.billed != null && <span className="muted"> billed {fmtMoney(c.billed, 2)}</span>}{c.lines > 1 && <span className="muted"> · {c.lines} service lines</span>}</dd>
          <dt>CPT</dt><dd className="mono">{c.cpt || "–"}</dd>
          <dt>Provider</dt><dd>{c.provider || "–"}</dd>
          <dt>Priority</dt><dd><span className="mono b">{c.priority}</span> <span className="muted">· {c.priority_reason}</span></dd>
          <dt>Suggested action</dt><dd>{STATUS_ACTION[c.status_class] || STATUS_ACTION.unknown}</dd>
          {c.state_reason && <><dt>State note</dt><dd>{c.state_reason}</dd></>}
          {c.assigned_name && <><dt>Assigned to</dt><dd>{c.assigned_name}{c.assigned_at ? <span className="muted"> · {fmtWhen(c.assigned_at)}</span> : null}</dd></>}
          {c.follow_up_on && <><dt>Follow-up on</dt><dd>{fmtDate(c.follow_up_on)}</dd></>}
          {c.last_status_code && <><dt>Last SAAG</dt><dd><span className="badge ink">{c.last_status_code}</span> {c.last_sub_status && <span className="badge gray">{c.last_sub_status}</span>} <span className="badge">{c.last_action_code}</span> {c.last_bucket && <span className={"badge " + (c.last_bucket === "Closed" ? "green" : "teal")}>{c.last_bucket}</span>} {c.last_effective && <span className="badge blue">{c.last_effective}</span>} <span className="muted">on {fmtDate(c.last_worked_on)}</span></dd></>}
        </dl>
      </div>
      <div className="card tight">
        <div className="row between"><div className="b small">From the inventory file</div><button className="btn sm link" onClick={() => setMore(!more)}>{more ? "Less" : "Full claim details"}</button></div>
        <div className="small mt8"><b>{c.file_status || "–"}</b>{c.file_sub_status ? <span className="muted"> · {c.file_sub_status}</span> : null}{c.file_action ? <span className="muted"> · {c.file_action}</span> : null}{c.last_worked_on && c.worked_before ? <span className="muted"> · worked {fmtDate(c.last_worked_on)}</span> : null}</div>
        {!more && c.file_comments && <div className="small muted mt8" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{c.file_comments}</div>}
        {more && (
          <>
            <dl className="kv mt8">
              <dt>Status</dt><dd>{c.file_status || "–"}</dd>
              <dt>Sub status</dt><dd>{c.file_sub_status || "–"}</dd>
              <dt>Action</dt><dd>{c.file_action || "–"}</dd>
              <dt>Comments</dt><dd style={{ whiteSpace: "pre-wrap" }}>{c.file_comments || "–"}</dd>
              {c.file_bucket && <><dt>Bucket</dt><dd>{c.file_bucket}</dd></>}
              {c.last_worked_on && c.worked_before && <><dt>Date worked</dt><dd>{fmtDate(c.last_worked_on)}</dd></>}
              {Object.keys(raw).length > 0 && <><dt>All file columns</dt><dd><FileColumns raw={raw} /></dd></>}
            </dl>
            {c.lines && c.lines.length > 1 && <div className="mt8"><div className="tiny muted b">SERVICE LINES</div><table className="t"><thead><tr><th>CPT</th><th>DOS</th><th className="r">Balance</th></tr></thead><tbody>{c.lines.map((l, i) => <tr key={i}><td className="mono small">{l.cpt || "–"}</td><td className="small">{fmtDate(l.dos)}</td><td className="num">{fmtMoney(l.balance, 2)}</td></tr>)}</tbody></table></div>}
          </>
        )}
      </div>
    </div>
  );
}
/* The work entry: SAAG selection + the standard note. Used on the desk and to edit a note. */
/* Source and ACTION: pick from the list, or "Other" to type it when the right one is not there. */
function ComboOther({ value, list, onChange, placeholder, width }) {
  const inList = !value || list.includes(value);
  const [other, setOther] = useState(!inList);
  useEffect(() => { if (value && !list.includes(value)) setOther(true); }, [value]);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <Combo value={other ? "__other" : value} width={width} placeholder={placeholder} onChange={(v) => { if (v === "__other") { setOther(true); onChange(""); } else { setOther(false); onChange(v); } }}
        options={[...list.filter((x) => x !== "Other").map((x) => ({ id: x, label: x })), { id: "__other", label: "Other (type it)…" }]} />
      {other && <input className="input sm" autoFocus placeholder="type it here" value={value || ""} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}
/* The standard note's first row: DOS, CLM#, DENIAL, SOURCE, REF, ACTION. */
function NoteFieldsRow({ note, setN }) {
  const mins = callMins(note.call_start, note.call_end);
  return (
    <>
    <div className="grid g5">
      <Field label="DOS" hint="from the claim"><input className="input" value={mmdd(note.dos) || note.dos} readOnly /></Field>
      <Field label="CLM#"><input className="input mono" value={note.clm} onChange={(e) => setN("clm")(e.target.value)} /></Field>
      <Field label="Denial" hint="denial reason"><input className="input" list="saag-subs" value={note.denial} onChange={(e) => setN("denial")(e.target.value)} /></Field>
      <Field label="Source"><ComboOther value={note.source} list={NOTE_SOURCES} onChange={setN("source")} placeholder="Where from?" /></Field>
      <Field label={note.source === "Call" ? "REF · call ref (required)" : "REF"}><input className="input mono" value={note.ref} onChange={(e) => setN("ref")(e.target.value)} placeholder={note.source === "Call" ? "call reference #" : "reference # if any"} /></Field>
    </div>
    {note.source === "Call" && <div className="row mt8" style={{ gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
      <Field label="Call start time (required)"><input className="input" type="time" style={{ width: 140 }} value={note.call_start || ""} onChange={(e) => setN("call_start")(e.target.value)} /></Field>
      <Field label="Call end time (required)"><input className="input" type="time" style={{ width: 140 }} value={note.call_end || ""} onChange={(e) => setN("call_end")(e.target.value)} /></Field>
      <div className="tiny muted" style={{ paddingBottom: 8 }}>{mins != null ? <b>Call time: {Math.floor(mins / 60) ? Math.floor(mins / 60) + " h " : ""}{mins % 60} min. </b> : null}The times of the call itself; they are not added to the note: they fill the Start / End Time and Total Duration columns of the Production Excel and the dashboard's time on calls.</div>
    </div>}
    </>
  );
}
/* TFL / AFL boxes: prefilled with what is saved for this insurance; whatever the biller saves updates the insurance's limits for the team. */
const limitsInit = (c) => { const l = (c && c.payer_limits) || {}; return { tfl: l.tfl_days ? String(l.tfl_days) : "", afl: l.afl_days ? String(l.afl_days) : "", denial_date: (c && c.denial_date) || "" }; };
const leftText = (left) => (left < 0 ? Math.abs(left) + (left === -1 ? " day" : " days") + " past" : left + (left === 1 ? " day" : " days") + " left");
function LimitsRow({ note, setN, claim }) {
  const l = (claim && claim.payer_limits) || null;
  const tfl = limDays(note.tfl), dl = tflDeadline(claim && claim.dos, tfl), left = dl ? daysUntil(dl) : null;
  const adl = tflDeadline(note.denial_date, limDays(note.afl)), aleft = adl ? daysUntil(adl) : null;
  const bad = (v) => String(v || "").trim() && !limDays(v);
  return (
    <div className="row mt8" style={{ gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
      <Field label="TFL · timely filing limit (days from DOS)"><input className="input" style={{ width: 150, borderColor: bad(note.tfl) ? "#E24B4A" : undefined }} inputMode="numeric" value={note.tfl || ""} onChange={(e) => setN("tfl")(e.target.value)} placeholder="e.g. 90" /></Field>
      <Field label="AFL · appeal filing limit (days from denial / EOB)"><input className="input" style={{ width: 150, borderColor: bad(note.afl) ? "#E24B4A" : undefined }} inputMode="numeric" value={note.afl || ""} onChange={(e) => setN("afl")(e.target.value)} placeholder="e.g. 180" /></Field>
      <Field label="Denial / EOB date (AFL counts from it)"><input className="input" type="date" style={{ width: 170 }} max={todayISO()} value={note.denial_date || ""} onChange={(e) => setN("denial_date")(e.target.value)} /></Field>
      <div className="tiny muted" style={{ flex: 1, minWidth: 220, paddingBottom: 6 }}>
        {dl ? <b style={{ color: riskColor(left) }}>TFL deadline {fmtDate(dl)} · {leftText(left)}. </b> : null}
        {adl ? <b style={{ color: riskColor(aleft) }}>AFL deadline {fmtDate(adl)} · {leftText(aleft)}. </b> : null}
        {l ? <>Saved for {claim.payer} by {l.updated_by_name || "the team"} on {fmtWhen(l.updated_at)}; change it if the payer told you different. </> : <>Optional. Not saved yet for {claim && claim.payer ? claim.payer : "this insurance"}. </>}
        Saved per insurance; the automatic priority moves claims up as their TFL / AFL deadline gets close.
      </div>
    </div>
  );
}
/* Pre call check: the usual items as chips, plus a box for anything else that was verified. */
function PreCheck({ note, togglePre, setN }) {
  return (
    <div className="field mt8"><span>Pre call check · what was verified before acting</span>
      <div className="pill-list mt8">{PRECHECKS.map((p) => <button key={p} type="button" className={"chip " + (note.precheck.includes(p) ? "on" : "")} onClick={() => togglePre(p)}>{p}</button>)}</div>
      <input className="input sm mt8" placeholder="anything else you verified (type it)" value={note.precheck_text} onChange={(e) => setN("precheck_text")(e.target.value)} /></div>
  );
}
function WorkForm({ claim, initial, buttons, onSave, onCancel, onChange, compact, attachments, newFiles, extraActions }) {
  const today = todayISO();
  const init = initial || {};
  const [saag, setSaag] = useState(() => ({ status: "", sub_status: "", action: "", effective: "", bucket: "", ...(init.saag || {}) }));
  const [note, setNote] = useState(() => ({ dos: claim.dos || "", clm: claim.claim_no || "", denial: claim.file_sub_status || "", source: "", ref: "", precheck: [], precheck_text: "", findings: "", ...limitsInit(claim), ...(init.note || {}) }));
  const [followUp, setFollowUp] = useState(init.follow_up_on || "");
  const [escalate, setEscalate] = useState(!!init.escalate);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const subs = saagSubs(saag.status);
  const acts = saagActions(saag.status, saag.sub_status);
  const closed = isClosedSaag(saag);
  const autoFollow = saag.effective ? addDaysISO(today, EFFECTIVE_DAYS[saag.effective] || claim.client_follow_up_days || 30) : "";
  const fu = closed ? "" : (followUp || autoFollow);
  useEffect(() => { if (onChange) onChange({ saag, note }); }, [saag.sub_status, saag.action]);
  const pickStatus = (v) => setSaag({ status: v, sub_status: "", action: "", effective: "", bucket: "" });
  const pickSub = (v) => { setSaag((s) => ({ ...s, sub_status: v, action: "", effective: "", bucket: "" })); setNote((n) => ({ ...n, denial: (!n.denial || SAAG.subStatuses.includes(n.denial)) ? v : n.denial })); };
  const pickAction = (v) => { const a = acts.find((x) => x.action === v); const eff = a ? a.effective : ""; setSaag((s) => ({ ...s, action: v, effective: eff, bucket: EFFECTIVE_BUCKET[eff] || s.bucket || "" })); };
  const togglePre = (p) => setNote((n) => ({ ...n, precheck: n.precheck.includes(p) ? n.precheck.filter((x) => x !== p) : [...n.precheck, p] }));
  // what the team picked most for this payer, and the team's note templates
  const sug = useRpc("saag.suggest", { client_id: claim.client_id, payer: claim.payer }, [claim.id], !!claim.client_id);
  const tpl = useRpc("templates.list", { client_id: claim.client_id }, [claim.client_id], !!claim.client_id);
  // only combinations still in the SAAG list (an old or renamed one would leave the boxes half filled)
  const sugRows = ((sug.data && sug.data.rows) || []).filter((x) => saagActions(x.status, x.sub_status).some((y) => y.action === x.action));
  const pickSug = (x) => {
    const a = saagActions(x.status, x.sub_status).find((y) => y.action === x.action);
    const eff = a ? a.effective : "";
    setSaag({ status: x.status, sub_status: x.sub_status, action: x.action, effective: eff, bucket: EFFECTIVE_BUCKET[eff] || x.bucket || "" });
    setNote((n) => ({ ...n, denial: (!n.denial || SAAG.subStatuses.includes(n.denial)) ? x.sub_status : n.denial }));
  };
  const insertTpl = (id) => { const tt = ((tpl.data && tpl.data.rows) || []).find((x) => x.id === id); if (tt) setNote((n) => ({ ...n, findings: (n.findings ? n.findings.replace(/\s+$/, "") + " " : "") + tt.text })); };
  const missing = [];
  if (!saag.status || !saag.sub_status || !saag.action) missing.push("SAAG status, sub-status and action");
  if (!saag.bucket) missing.push("bucket");
  if (String(note.findings || "").trim().length < 8) missing.push("RCA / findings");
  if (note.source === "Call" && !String(note.ref || "").trim()) missing.push("call REF");
  if (note.source === "Call" && (!note.call_start || !note.call_end)) missing.push("call start and end time");
  if ((String(note.tfl || "").trim() && !limDays(note.tfl)) || (String(note.afl || "").trim() && !limDays(note.afl))) missing.push("TFL / AFL as a number of days");
  const needFile = attachNeeded(saag);
  if (needFile && newFiles === 0) missing.push(`an attachment (EOB / appeal document) for "${needFile}"`);
  const ready = !missing.length;
  const noteMissing = missing.filter((m) => m === "RCA / findings" || m === "call REF");
  const preview = composeNote({ ...note, dos: mmdd(note.dos) || note.dos }, saag, fu);
  const submit = async (key) => { setBusy(key); setErr(null); try { await onSave({ saag, note, follow_up_on: fu, escalate }, key); } catch (e) { setErr(e.message); } setBusy(null); };
  const sel = (v, on, list, ph, dis) => <Combo value={v} onChange={on} disabled={dis} placeholder={ph} options={[{ id: "", label: ph }, ...list.map((x) => ({ id: x, label: x }))]} />;
  const setN = (k) => (v) => setNote((n) => ({ ...n, [k]: v }));
  return (
    <div className="stack">
      <div className="group">
        <div className="gt row" style={{ gap: 8 }}><span className="stepn">1</span>SAAG entry</div>
        {sugRows.length > 0 && !saag.status && <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "2px 0 8px" }}><span className="tiny muted">Used most {sug.data.scope === "payer" ? "for " + claim.payer : "at this client"}:</span>
          {sugRows.map((x, i) => <button key={i} type="button" className="chip" title={"Picked " + x.n + " times in the last 90 days"} onClick={() => pickSug(x)}>{x.status} › {x.sub_status} › {x.action} <span className="tiny muted">({x.n})</span></button>)}</div>}
        <div className="grid g4">
          <Field label="Status">{sel(saag.status, pickStatus, SAAG.statuses, "Pick a status…")}</Field>
          <Field label="Sub-status">{sel(saag.sub_status, pickSub, subs, saag.status ? "Pick a sub-status…" : "Pick a status first", !saag.status)}</Field>
          <Field label="Action">{sel(saag.action, pickAction, acts.map((a) => a.action), saag.sub_status ? "Pick an action…" : "Pick a sub-status first", !saag.sub_status)}</Field>
          <Field label="Bucket" hint={saag.effective ? "Effective matrix: " + saag.effective : "set from the action; change it if needed"}><Combo value={saag.bucket} onChange={(v) => setSaag((s) => ({ ...s, bucket: v }))} placeholder="Pick…" options={BUCKETS4.map((b) => ({ id: b, label: b }))} /></Field>
        </div>
      </div>
      <div className="group">
        <div className="gt row" style={{ gap: 8 }}><span className="stepn">2</span>Note · saved as one cell in the standard format</div>
        <NoteFieldsRow note={note} setN={setN} />
        <LimitsRow note={note} setN={setN} claim={claim} />
        <PreCheck note={note} togglePre={togglePre} setN={setN} />
        <div style={{ display: "grid", gridTemplateColumns: attachments ? "minmax(0,2fr) minmax(0,1fr)" : "1fr", gap: 14, marginTop: 10 }}>
          <Field label={<span className="row between" style={{ gap: 8 }}><span>RCA / findings</span>{tpl.data && tpl.data.rows.length > 0 && <span style={{ minWidth: 220, textTransform: "none", letterSpacing: 0 }}><Combo sm value="" onChange={(v) => v && insertTpl(v)} placeholder="Insert a template…" options={tpl.data.rows.map((x) => ({ id: x.id, label: x.title, sub: x.client_name || "" }))} /></span>}</span>}><textarea className="textarea" value={note.findings} onChange={(e) => setN("findings")(e.target.value)} placeholder="What the payer or portal said, the root cause, and what happens next." /></Field>
          {attachments && <div>{needFile && <div className={"alert " + (newFiles ? "info" : "warn") + " mb"} style={{ fontSize: 12.5 }}>{newFiles ? `Document attached for "${needFile}".` : `"${needFile}" needs the document: attach the EOB / appeal / reconsideration file before saving.`}</div>}{attachments}</div>}
        </div>
      </div>
      <div className="group">
        <div className="gt row" style={{ gap: 8 }}><span className="stepn">3</span>Follow-up</div>
        <div className="row" style={{ gap: 18, alignItems: "flex-end", flexWrap: "wrap" }}>
          {!closed && <Field label="Follow-up date" hint={autoFollow ? `Auto ${fmtDate(autoFollow)} from the effective matrix${EFFECTIVE_DAYS[saag.effective] ? ` (${EFFECTIVE_DAYS[saag.effective]} days)` : ""}. Change it if the payer gave a date.` : "set once you pick the action"}><input className="input" type="date" style={{ width: 190 }} value={fu} min={today} onChange={(e) => setFollowUp(e.target.value)} /></Field>}
          {closed && saag.status && <div className="alert info">This entry closes the claim: it leaves the desk and the follow-up list.</div>}
          {!compact && <label className="check" style={{ paddingBottom: 8 }}><input type="checkbox" checked={escalate} onChange={(e) => setEscalate(e.target.checked)} /> Flag for my team lead (escalate)</label>}
          <span style={{ flex: 1 }} />{extraActions}
        </div>
      </div>
      <ErrorBox error={err} />
      <div className="wf-bar">
        <span className="tiny muted b" style={{ whiteSpace: "nowrap" }}>NOTE PREVIEW</span>
        <div className="cell">{preview}</div>
        {!ready && <span className="tiny" style={{ color: "var(--amber-ink)", maxWidth: 220 }}>Still needed: {missing.join(", ")}.</span>}
        {onCancel && <button className="btn" type="button" onClick={onCancel} disabled={!!busy}>Cancel</button>}
        {(buttons || [{ key: "save", label: "Save", primary: true }]).map((b) => <button key={b.key} type="button" title={b.title} className={"btn " + (b.primary ? "primary" : "")} disabled={(b.noSaag ? noteMissing.length > 0 : !ready) || !!busy} onClick={() => submit(b.key)}>{busy === b.key ? "Saving…" : b.label}</button>)}
      </div>
      <datalist id="saag-subs">{SAAG.subStatuses.map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}
/* Next-step suggestions from the Gurukul denial library, matched to the SAAG sub-status or the file's wording. */
function Suggestions({ claim, subStatus }) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState(null);
  const auto = useMemo(() => suggestFor({ subStatus, claim }), [subStatus, claim && claim.id]);
  const matches = useMemo(() => (q.trim().length < 2 ? [] : LIB.filter((e) => (e.name + " " + (e.keywords || []).join(" ") + " " + (e.codes || []).join(" ")).toLowerCase().includes(q.toLowerCase())).slice(0, 8)), [q]);
  const show = pick ? [{ entry: pick, why: "picked from the library" }] : auto;
  /* Short by default: the playbook's name, one-line summary and the first two steps. "Full details" opens the rest. */
  const [full, setFull] = useState({});
  const toggle = (name) => setFull((f) => ({ ...f, [name]: !f[name] }));
  return (
    <div className="card tight">
      <div className="row between"><div className="b small">Suggested next steps <span className="tiny muted">· Purview Gurukul denial library</span></div>
        <input className="input sm" style={{ width: 220 }} placeholder="search the library…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {matches.length > 0 && <div className="pill-list mt8">{matches.map((e) => <button key={e.name} className="chip" onClick={() => { setPick(e); setQ(""); }}>{e.name}</button>)}</div>}
      {!show.length && <div className="muted small mt8">No playbook matched the file's status or notes yet. Pick a SAAG sub-status, or search the library.</div>}
      <div className="sug-grid mt8">{show.slice(0, full.__all ? show.length : 3).map(({ entry, why }) => { const open = !!full[entry.name]; const steps = entry.actions || []; const qs = entry.questions || []; return (
        <div key={entry.name} className="sug">
          <div className="row between"><span className="b">{entry.name} {(entry.codes || []).map((c) => <span key={c} className="badge gray" style={{ marginLeft: 4 }}>{c}</span>)}</span><span className="row" style={{ gap: 8 }}><span className="tiny muted">{why}</span><button className="btn sm link" onClick={() => toggle(entry.name)}>{open ? "Less" : "Full details"}</button></span></div>
          {!open && <div className="small mt8" style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{entry.summary}</div>}
          {!open && steps.length > 0 && <ol className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{steps.slice(0, 2).map((x, i) => <li key={i}>{x}</li>)}{steps.length > 2 && <li className="muted" style={{ listStyle: "none", marginLeft: -18 }}>… {steps.length - 2} more in full details</li>}</ol>}
          {open && (
            <>
              <div className="small mt8">{entry.summary}</div>
              {qs.length > 0 && <div className="mt8"><div className="tiny b muted">ASK THE PAYER</div><ul>{qs.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
              {steps.length > 0 && <div className="mt8"><div className="tiny b muted">NEXT STEPS</div><ol>{steps.map((x, i) => <li key={i}>{x}</li>)}</ol></div>}
              {entry.url && <div className="tiny mt8"><a href={entry.url} target="_blank" rel="noopener">Source</a></div>}
            </>
          )}
        </div>); })}
      </div>
      {show.length > 3 && !full.__all && <button className="btn sm link mt8" onClick={() => toggle("__all")}>Show {show.length - 3} more suggestions</button>}
      {pick && <button className="btn sm link mt8" onClick={() => setPick(null)}>back to automatic suggestions</button>}
    </div>
  );
}
/* Files kept with the claim next to its notes: EOBs, denial letters, portal screenshots, call logs. */
const ATTACH_MAX = 8 * 1024 * 1024;
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
  r.onerror = () => reject(new Error("Could not read " + file.name + "."));
  r.readAsDataURL(file);
});
function base64Blob(data, type) { const bin = atob(data); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new Blob([bytes], { type: type || "application/octet-stream" }); }
function Attachments({ claimId, files, onChanged, plain }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(null);
  const [del, setDel] = useState(null);
  const list = files || [];
  const attach = async (picked) => {
    const fl = [...(picked || [])];
    if (input.current) input.current.value = "";
    if (!fl.length) return;
    let added = 0;
    for (const f of fl) {
      if (f.size > ATTACH_MAX) { toast(f.name + " is larger than " + fmtBytes(ATTACH_MAX) + ".", "err"); continue; }
      setBusy("Attaching " + f.name + "…");
      try { await rpc("attachments.add", { claim_id: claimId, name: f.name, type: f.type, data: await fileToBase64(f) }); added++; }
      catch (e) { toast(e.message, "err"); }
    }
    setBusy(null);
    if (added) { toast(added > 1 ? added + " files attached." : "File attached."); if (onChanged) onChanged(); }
  };
  const open = async (a, save) => {
    // The tab is opened before the download so the browser does not treat it as a pop-up.
    const win = save ? null : window.open("", "_blank");
    setBusy("Opening " + a.name + "…");
    try {
      const r = await rpc("attachments.get", { id: a.id });
      // Only safe types open in a tab; anything else (an SVG or HTML file can carry a script) is a plain download.
      const url = URL.createObjectURL(base64Blob(r.data, !save && SAFE_VIEW.test(r.type || "") ? r.type : "application/octet-stream"));
      if (win) win.location.href = url;
      else { const link = document.createElement("a"); link.href = url; link.download = r.name; document.body.appendChild(link); link.click(); link.remove(); }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) { if (win) win.close(); toast(e.message, "err"); }
    setBusy(null);
  };
  const remove = async () => {
    setBusy("Removing…");
    try { await rpc("attachments.delete", { id: del.id }); toast("Attachment removed."); setDel(null); if (onChanged) onChanged(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(null);
  };
  const viewable = (a) => SAFE_VIEW.test(a.type || "");
  return (
    <div className={plain ? "" : "card tight"} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (!busy) attach(e.dataTransfer.files); }}>
      <div className="row between">
        <div className="b small">Attachments ({list.length}) <span className="tiny muted" style={{ fontWeight: 400 }}>· EOBs, letters, screenshots; up to {fmtBytes(ATTACH_MAX)} each</span></div>
        <button className="btn sm" disabled={!!busy} onClick={() => input.current && input.current.click()}>📎 Attach file</button>
        <input ref={input} type="file" multiple style={{ display: "none" }} onChange={(e) => attach(e.target.files)} />
      </div>
      {busy && <div className="tiny muted mt8">{busy}</div>}
      {!list.length && !busy && <div className="tiny muted mt8">No files yet. Click Attach file, or drop files here.</div>}
      {list.map((a) => (
        <div key={a.id} className="row between mt8" style={{ gap: 6 }}>
          <span className="small" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📄 <button className="btn sm link" disabled={!!busy} onClick={() => open(a, !viewable(a))} title={viewable(a) ? "Open in a new tab" : "Download"}>{a.name}</button>
            <span className="tiny muted"> · {fmtBytes(a.size)} · {a.user_name} · {fmtWhen(a.created_at)}</span></span>
          <span className="row" style={{ gap: 4, flexShrink: 0 }}>
            <button className="btn sm link" disabled={!!busy} onClick={() => open(a, true)}>Download</button>
            {a.deletable && <button className="btn sm link" disabled={!!busy} onClick={() => setDel(a)}>Remove</button>}
          </span>
        </div>
      ))}
      {del && <Confirm title="Remove this attachment?" text={del.name + " will be removed from the claim for everyone."} confirmLabel="Remove" danger onYes={remove} onNo={() => setDel(null)} busy={!!busy} />}
    </div>
  );
}
function NotesList({ notes, me, claim, onChanged }) {
  const [editing, setEditing] = useState(null);
  const saveEdit = async (n, data) => { await rpc("notes.update", { id: n.id, ...data }); toast("Note updated."); setEditing(null); if (onChanged) onChanged(); };
  return (
    <div className="card tight">
      <div className="b small mb">History ({notes.length})</div>
      {!notes.length && <div className="muted small">No notes yet.</div>}
      {notes.map((n) => {
        const f = n.fields || {};
        return (
          <div key={n.id} className={"note " + n.kind}>
            <div className="row between">
              <span className="small"><b>{n.user_name}</b> <span className="muted">· {fmtWhen(n.created_at)}</span>{n.edited_at ? <span className="tiny muted"> · edited {fmtWhen(n.edited_at)}</span> : null}</span>
              <span className="row" style={{ gap: 6 }}>
                <span className="tiny muted">{n.kind === "work" ? "worked" : n.kind === "skip" ? "skipped" : "note"}</span>
                {n.kind === "work" && (n.editable && claim ? <button className="btn sm link" onClick={() => setEditing(editing === n.id ? null : n.id)}>{editing === n.id ? "Cancel" : "Edit"}</button> : <span className="tiny muted" title="Only the person who wrote it or a team lead can edit it">read-only</span>)}
              </span>
            </div>
            {n.kind === "work" && editing !== n.id && (
              <>
                <div className="row mt8" style={{ gap: 6 }}><span className="badge ink">{n.status || n.status_code}</span>{n.sub_status && <span className="badge gray">{n.sub_status}</span>}<span className="badge">{n.action || n.action_code}</span>{n.bucket && <span className={"badge " + (n.bucket === "Closed" ? "green" : "teal")}>{n.bucket}</span>}{n.effective && <span className="badge blue">{n.effective}</span>}{n.follow_up_on && <span className="badge amber">follow-up {fmtDate(n.follow_up_on)}</span>}</div>
                {f.findings != null ? (
                  <dl className="kv mt8" style={{ gridTemplateColumns: "120px 1fr" }}>
                    <dt>DOS</dt><dd>{f.dos || "–"}</dd><dt>CLM#</dt><dd className="mono">{f.clm || "–"}</dd><dt>Denial</dt><dd>{f.denial || "–"}</dd>
                    <dt>Source</dt><dd>{f.source || "–"}{f.ref ? <span className="mono"> · REF {f.ref}</span> : null}</dd>
                    <dt>Pre call check</dt><dd>{[...(f.precheck || []), f.precheck_text].filter(Boolean).join("; ") || "–"}</dd>
                    <dt>RCA / findings</dt><dd style={{ whiteSpace: "pre-wrap" }}>{f.findings || "–"}</dd>{f.action ? <><dt>Action</dt><dd className="b">{f.action}</dd></> : null}
                  </dl>
                ) : <div className="small mt8" style={{ whiteSpace: "pre-wrap" }}>{n.comment}</div>}
                <details className="mt8"><summary className="tiny muted" style={{ cursor: "pointer" }}>one-cell note as stored</summary><div className="cell mt8">{n.comment}</div></details>
              </>
            )}
            {n.kind === "work" && editing === n.id && claim && (
              <div className="mt8"><WorkForm claim={claim} initial={{ saag: { status: n.status, sub_status: n.sub_status, action: n.action, effective: n.effective, bucket: n.bucket }, note: f, follow_up_on: n.follow_up_on }} buttons={[{ key: "save", label: "Save changes", primary: true }]} onSave={(data) => saveEdit(n, data)} onCancel={() => setEditing(null)} compact /></div>
            )}
            {n.kind !== "work" && <div className="small mt8" style={{ whiteSpace: "pre-wrap" }}>{n.comment}</div>}
          </div>
        );
      })}
    </div>
  );
}
function Siblings({ rows, users, selectable, selected, onToggle, meId }) {
  if (!rows || !rows.length) return null;
  const nameOf = (id) => (id === meId ? "you" : (users.find((u) => u.id === id) || {}).name || "a colleague");
  return (
    <div className="card tight">
      <div className="b small mb">Other open claims for this patient ({rows.length})</div>
      <table className="t"><thead><tr>{selectable && <th />}<th>Claim #</th><th>DOS</th><th>Payer</th><th className="r">Balance</th><th>State</th><th>With</th></tr></thead>
        <tbody>{rows.map((s) => { const mine = s.assigned_to === meId && (s.state === "assigned" || s.state === "in_progress"); return (
          <tr key={s.id}>{selectable && <td>{mine ? <input type="checkbox" checked={selected.has(s.id)} onChange={() => onToggle(s.id)} /> : null}</td>}<td className="mono small">{s.claim_no || "–"}</td><td className="small">{fmtDate(s.dos)}</td><td className="small">{s.payer}</td><td className="num">{fmtMoney(s.balance)}</td><td><StateBadge state={s.state} /></td><td className="small">{s.assigned_to ? nameOf(s.assigned_to) : "–"}</td></tr>); })}</tbody></table>
      {selectable && <div className="tiny muted mt8">Tick claims to apply the same status, action and note to them (only claims assigned to you can be ticked).</div>}
    </div>
  );
}

/* ---------- allocation ---------- */
function AllocateView({ ctx, params, go, embedded }) {
  const [clientId, setClientId] = useState((params && params.clientId) || "");
  const [locId, setLocId] = useState("");
  const [pool, setPool] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ kinds: { fresh: true, worked: true }, followUps: true, tiers: { High: true, Medium: true, Low: true }, classes: Object.fromEntries(STATUS_ORDER.map((k) => [k, true])), payers: {}, minBalance: 0 });
  const [strategy, setStrategy] = useState("smart");
  const [plan, setPlan] = useState(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(null);
  const stats = useRpc("claims.stats", { client_id: clientId || undefined, location_id: locId || undefined }, [clientId, locId], !!clientId);
  const today = todayISO();
  const loadPool = async () => {
    if (!clientId) return;
    setLoading(true); setPlan(null);
    try { const r = await rpc("claims.eligible", { client_id: clientId, location_id: locId || undefined }); setPool(rescore(r.claims, today)); }
    catch (e) { toast(e.message, "err"); }
    setLoading(false);
  };
  useEffect(() => { setPool(null); setPlan(null); setApplied(null); if (clientId) loadPool(); }, [clientId, locId]);
  // Who gets the claims: the client's people (the location's own team when it has one), minus anyone out today in
  // Team today, each up to their daily target. People are changed on the client card.
  const [members, setMembers] = useState(null);
  useEffect(() => {
    if (!clientId) { setMembers(null); return undefined; }
    let alive = true;
    setMembers(null);
    rpc("team.today", { client_id: clientId, location_id: locId || undefined, day: todayISO() }).then((dt) => { if (alive) setMembers(dt.members); }).catch(() => alive && setMembers([]));
    return () => { alive = false; };
  }, [clientId, locId]);
  const payersAll = useMemo(() => { if (!pool) return []; const m = {}; pool.forEach((c) => { const k = c.payer || "Unknown"; m[k] = m[k] || { payer: k, n: 0, amt: 0 }; m[k].n++; m[k].amt += c.balance; }); return Object.values(m).sort((a, b) => b.amt - a.amt); }, [pool]);
  const filtered = useMemo(() => {
    if (!pool) return [];
    return pool.filter((c) => {
      if (!filters.kinds[c.worked_before ? "worked" : "fresh"]) return false;
      if (c.state === "completed" && !filters.followUps) return false;
      if (!filters.tiers[c.tier]) return false;
      if (filters.classes[c.status_class] === false) return false;
      if (Object.keys(filters.payers).length && !filters.payers[c.payer || "Unknown"]) return false;
      if (c.balance < (Number(filters.minBalance) || 0)) return false;
      return true;
    });
  }, [pool, filters]);
  const teamUsers = (members || []).filter((m) => !m.out).map((m) => ({ id: m.id, name: m.name, capacity: Math.max(0, Math.round(Number(m.cap) || 35)) }));
  const preview = () => { setPlan(planAllocation({ claims: filtered, users: teamUsers, strategy })); setApplied(null); };
  const apply = async () => {
    if (!plan || !plan.assignments.length) return;
    setApplying(true);
    try {
      let total = 0;
      for (const part of chunk(plan.assignments, 300)) { const r = await rpc("alloc.apply", { client_id: clientId, location_id: locId || undefined, strategy, assignments: part, summary: { perUser: plan.perUser, leftover: plan.leftover, filters } }); total += r.applied; }
      setApplied(total); toast(`Assigned ${fmtInt(total)} claims.`);
      setPlan(null); stats.reload(); loadPool();
    } catch (e) { toast(e.message, "err"); }
    setApplying(false);
  };
  const unassignUser = async (u) => { try { const r = await rpc("alloc.unassign", { user_id: u.user_id, client_id: clientId }); toast(`Returned ${fmtInt(r.changed)} unworked claims from ${u.name} to the pool.`); stats.reload(); loadPool(); } catch (e) { toast(e.message, "err"); } };
  const ToggleSet = ({ obj, keyName, label, onChange }) => <label className="check small"><input type="checkbox" checked={obj[keyName] !== false} onChange={(e) => onChange(keyName, e.target.checked)} /> {label}</label>;
  const capTotal = sum(teamUsers, (u) => u.capacity);
  const sel = filtered;
  return (
    <div className="stack">
      {embedded ? <div className="row" style={{ justifyContent: "flex-end" }}><AllocationLogicButton /></div> : <div className="row between top"><div><h1>Allocate claims</h1><div className="sub">Build the day's work order from the inventory and hand it out. Highest priority first; batches by patient and payer so one call covers several claims.</div></div><AllocationLogicButton /></div>}
      <div className="card">
        <div className="grid g3"><ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} locId={locId} setLocId={setLocId} /><div className="field"><span>Pool</span><div style={{ paddingTop: 6 }}>{loading ? <Spinner label="Loading claims…" /> : pool ? <span><b>{fmtInt(pool.length)}</b> eligible claims · {fmtMoney(sum(pool, (c) => c.balance))} <span className="muted">(unassigned, plus worked claims whose follow-up is due)</span></span> : <span className="muted">Pick a client to load its pool.</span>}</div></div></div>
      </div>
      {pool && (
        <>
          <div className="grid g2-1">
            <div className="card stack">
              <h3>1 · What goes out</h3>
              <div className="row" style={{ gap: 14 }}>
                <ToggleSet obj={filters.kinds} keyName="fresh" label="Fresh inventory" onChange={(k, v) => setFilters({ ...filters, kinds: { ...filters.kinds, [k]: v } })} />
                <ToggleSet obj={filters.kinds} keyName="worked" label="Previously worked" onChange={(k, v) => setFilters({ ...filters, kinds: { ...filters.kinds, [k]: v } })} />
                <label className="check small"><input type="checkbox" checked={filters.followUps} onChange={(e) => setFilters({ ...filters, followUps: e.target.checked })} /> Include follow-ups due ({fmtInt(pool.filter((c) => c.state === "completed").length)})</label>
              </div>
              <div className="row" style={{ gap: 14 }}><span className="small b">Tiers</span>{["High", "Medium", "Low"].map((t) => <ToggleSet key={t} obj={filters.tiers} keyName={t} label={`${t} (${fmtInt(pool.filter((c) => c.tier === t).length)})`} onChange={(k, v) => setFilters({ ...filters, tiers: { ...filters.tiers, [k]: v } })} />)}</div>
              <div className="row" style={{ gap: 14 }}><span className="small b">Status</span>{STATUS_ORDER.filter((k) => pool.some((c) => c.status_class === k)).map((k) => <ToggleSet key={k} obj={filters.classes} keyName={k} label={`${STATUS_LABEL[k]} (${fmtInt(pool.filter((c) => c.status_class === k).length)})`} onChange={(kk, v) => setFilters({ ...filters, classes: { ...filters.classes, [kk]: v } })} />)}</div>
              <div className="row" style={{ gap: 14, alignItems: "flex-start" }}><span className="small b" style={{ paddingTop: 6 }}>Payers</span>
                <div className="pill-list">{payersAll.slice(0, 14).map((p) => { const any = Object.keys(filters.payers).length; const on = any ? !!filters.payers[p.payer] : true; return <button key={p.payer} className={"chip " + (on ? "on" : "")} onClick={() => { const np = { ...filters.payers }; if (!any) { payersAll.forEach((x) => { np[x.payer] = true; }); } np[p.payer] = !on; if (Object.values(np).every((v) => v)) setFilters({ ...filters, payers: {} }); else setFilters({ ...filters, payers: np }); }}>{p.payer} <span className="muted">{fmtInt(p.n)} · {fmtMoney(p.amt)}</span></button>; })}
                  {Object.keys(filters.payers).length > 0 && <button className="btn sm link" onClick={() => setFilters({ ...filters, payers: {} })}>all payers</button>}</div></div>
              <div className="row"><span className="small b">Minimum balance</span><input className="input sm" type="number" style={{ width: 110 }} value={filters.minBalance} onChange={(e) => setFilters({ ...filters, minBalance: e.target.value })} /><span className="small muted">Low-tier claims (under $100) are clean-up work and score half; leave them in or filter them out.</span></div>
              <div className="alert info"><b>{fmtInt(sel.length)} claims · {fmtMoney(sum(sel, (c) => c.balance))}</b> selected to go out · High {fmtInt(sel.filter((c) => c.tier === "High").length)} · near filing limit (75–90d) {fmtInt(sel.filter((c) => c.age_days >= 75 && c.age_days <= 90).length)} · rejected/denied {fmtInt(sel.filter((c) => c.status_class === "rejected" || c.status_class === "denied").length)}</div>
            </div>
            <div className="card stack">
              <div className="row between"><h3>2 · Who works it</h3>{clientId && go && <button className="btn sm" onClick={() => go("clients", { client_id: clientId, focus: "people" })} title="Opens this client's card, where its people are added or taken off">Change people on the client card</button>}</div>
              {!members ? <Spinner label="Loading the client's people…" /> : !members.length ? <div className="alert warn" style={{ fontSize: 13 }}>Nobody is on this client yet. Add its people on the client card, then come back.</div> : <>
                <div className="small">Goes to the people on <b>{(ctx.clients.find((c) => c.id === clientId) || {}).name}</b>, each up to their daily target:</div>
                <div className="pill-list">{members.map((m) => <span key={m.id} className={"badge " + (m.out ? "gray" : "teal")} title={m.out ? "Marked out today in Team today" : "Daily target"} style={m.out ? { opacity: .7 } : null}>{m.name} {m.out ? <span className="red-ink">out today</span> : <b>{m.cap}</b>}</span>)}</div>
              </>}
              <div className="small muted">Capacity today: <b>{fmtInt(capTotal)}</b> claims across {teamUsers.length} {teamUsers.length === 1 ? "person" : "people"}. Someone off today? Mark them in <b>Work › Team today › Out today</b>; they are skipped here and in automatic allocation after an upload.</div>
              <h3>3 · How to split it</h3>
              <div className="stack" style={{ gap: 6 }}>{STRATEGIES.map((s) => <label key={s.key} className="check" style={{ alignItems: "flex-start" }}><input type="radio" name="strategy" checked={strategy === s.key} onChange={() => setStrategy(s.key)} style={{ marginTop: 3 }} /><span><b>{s.label}</b><div className="tiny muted">{s.desc}</div></span></label>)}</div>
              <button className="btn primary" disabled={!sel.length || !teamUsers.length} onClick={preview}>Preview allocation</button>
            </div>
          </div>
          {plan && (
            <div className="card stack">
              <div className="row between"><h3>4 · Preview</h3><span className="small muted">{fmtInt(plan.assignments.length)} claims go out · {fmtInt(plan.leftover)} stay in the pool ({fmtMoney(plan.leftoverAmt)}) for lack of capacity</span></div>
              <div className="table-wrap"><table className="t"><thead><tr><th>Team member</th><th className="r">Claims</th><th className="r">Capacity</th><th className="r">Balance</th><th className="r">High tier</th><th className="r">Near TFL</th><th className="r">Batches</th><th>Top payers</th></tr></thead>
                <tbody>{plan.perUser.map((u) => <tr key={u.id}><td><b>{u.name}</b></td><td className="num">{fmtInt(u.count)}</td><td className="num">{fmtInt(u.capacity)}</td><td className="num">{fmtMoney(u.amt)}</td><td className="num">{fmtInt(u.high)}</td><td className="num">{fmtInt(u.urgent)}</td><td className="num">{fmtInt(u.batches)}</td><td className="small">{u.topPayers.join(", ")}</td></tr>)}</tbody></table></div>
              <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn" onClick={() => setPlan(null)}>Discard</button><button className="btn primary" disabled={applying || !plan.assignments.length} onClick={apply}>{applying ? "Assigning…" : `Assign ${fmtInt(plan.assignments.length)} claims`}</button></div>
            </div>
          )}
          {applied != null && typeof applied === "number" && <div className="alert info"><b>{fmtInt(applied)} claims assigned.</b> Team members see them on their My queue screen in priority order. <button className="btn link sm" onClick={() => go("claims", { clientId })}>Browse the claims</button></div>}
          <div className="card">
            <div className="row between"><h3>Currently on desks for this client</h3><span className="small muted">Claims a person has not finished can be returned to the pool.</span></div>
            <div className="table-wrap"><table className="t"><thead><tr><th>Team member</th><th className="r">Assigned</th><th className="r">In progress</th><th className="r">Worked</th><th className="r">On desk $</th><th></th></tr></thead>
              <tbody>{(stats.data ? stats.data.users : []).map((u) => <tr key={u.user_id}><td>{u.name}</td><td className="num">{fmtInt(u.assigned)}</td><td className="num">{fmtInt(u.in_progress)}</td><td className="num">{fmtInt(u.completed)}</td><td className="num">{fmtMoney(u.amt)}</td><td className="r">{(u.assigned > 0 || u.in_progress > 0) && <button className="btn sm" onClick={() => unassignUser(u)}>Return unworked to pool</button>}</td></tr>)}
                {stats.data && !stats.data.users.length && <tr><td colSpan={6} className="muted">Nothing assigned yet for this client.</td></tr>}</tbody></table></div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- team ---------- */
const projectsText = (list) => (list || []).map((p) => p.name + (p.share != null ? " " + p.share + "%" : "")).join("; ");
const parseProjectsText = (t) => String(t || "").split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = x.match(/^(.*?)\s*([\d.]+)\s*%$/); return m ? { name: m[1].trim(), share: Number(m[2]) } : { name: x, share: null }; });
/* A person's crossover access, shown in their Team profile; the same shares as on the client cards. */
function PersonClientAccess({ userId, ctx, me }) {
  const q = useRpc("clients.accessList", { user_id: userId }, [userId]);
  const rows = (q.data && q.data.rows) || [];
  const [pick, setPick] = useState("");
  const [level, setLevel] = useState("view");
  const [busy, setBusy] = useState(false);
  const canShare = !isSmeUI(me);
  const opts = ctx.clients.filter((c) => c.active && c.can_edit !== false && !rows.some((r) => r.client_id === c.id)).map((c) => ({ id: c.id, label: c.name }));
  const add = async () => { if (!pick) return; setBusy(true); try { await rpc("clients.accessSave", { client_id: pick, user_id: userId, level }); toast("Shared."); setPick(""); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const rm = async (r) => { setBusy(true); try { await rpc("clients.accessRemove", { client_id: r.client_id, user_id: userId }); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  return (
    <Field label="Extra client access" hint="Clients outside this person's own span that are shared with them (crossovers)">
      <div className="pill-list" style={{ gap: 4 }}>
        {rows.map((r) => <span key={r.client_id} className="badge gray" title={"Shared by " + (r.granted_by_name || "?")}>{r.client_name} · {r.level === "edit" ? "can edit" : "view only"}{canShare && <button type="button" className="btn link sm" style={{ padding: "0 2px" }} disabled={busy} onClick={() => rm(r)}>×</button>}</span>)}
        {!rows.length && <span className="tiny muted">none</span>}
      </div>
      {canShare && opts.length > 0 && <div className="row mt8" style={{ gap: 6 }}>
        <span style={{ display: "inline-block", minWidth: 220 }}><Combo sm value={pick} onChange={setPick} placeholder="Share a client…" options={opts} /></span>
        <select className="input sm" style={{ width: "auto" }} value={level} onChange={(e) => setLevel(e.target.value)}><option value="view">View only</option><option value="edit">Can edit</option></select>
        <button type="button" className="btn sm" disabled={busy || !pick} onClick={add}>Share</button>
      </div>}
    </Field>
  );
}
/* Pull the team's roster from Purview Shastra now (any supervisor). It also updates by itself every hour. */
function RosterSyncButton({ onDone }) {
  const info = useRpc("team.rosterInfo", {}, []);
  const [busy, setBusy] = useState(false);
  const last = info.data && info.data.last;
  const sync = async () => {
    setBusy(true);
    try { const r = await rpc("team.syncRoster"); const m = r.summary || {}; toast(m.new + m.updated + m.deactivated ? `From Purview Shastra: ${m.new} joined, ${m.updated} changed, ${m.deactivated} left.` : "Synced with Purview Shastra: no changes."); info.reload(); onDone && onDone(); }
    catch (e) { toast(e.message, "err"); info.reload(); }
    setBusy(false);
  };
  if (info.data && !info.data.connected) return <span className="tiny muted">Purview Shastra is not connected yet</span>;
  return (
    <div className="row" style={{ gap: 8, alignItems: "center" }}>
      <span className="tiny muted" style={{ textAlign: "right" }}>{last ? (last.ok ? "Roster synced " + fmtWhen(last.at) + (last.by && last.by !== "hourly" ? " by " + last.by : " (hourly)") : <span className="red-ink">Last sync {fmtWhen(last.at)} failed: {String(last.error || "").slice(0, 80)}</span>) : "Updates from Shastra every hour"}</span>
      <button className="btn" disabled={busy || !info.data} onClick={sync} title="Pull the latest roster (people, projects, managers, exits) from Purview Shastra now">{busy ? "Syncing…" : "⟳ Sync from Purview Shastra"}</button>
    </div>
  );
}
function TeamView({ ctx, reload, me }) {
  const [edit, setEdit] = useState(null);
  const [find, setFind] = useState("");
  const [tempPw, setTempPw] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [pr, setPr] = useState(() => newRange("week"));
  const range = (([from, to]) => ({ from, to }))(rangeSpan(pr));
  const prod = useRpc("supervisor.productivity", { from_ms: dayBounds(range.from)[0], to_ms: dayBounds(range.to)[1] }, [range.from, range.to]);
  const [codeFor, setCodeFor] = useState(null);
  const [delFor, setDelFor] = useState(null);
  const doDelete = async () => {
    setBusy(true);
    try { await rpc("users.delete", { id: delFor.id }); toast(delFor.name + " was deleted. Their open claims are back in the pool."); setDelFor(null); reload(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true);
    try {
      const { projects_text, email_missing, ...payload } = edit;
      payload.projects = parseProjectsText(projects_text);
      if (edit.id && (!(me.is_admin || email_missing) || !String(edit.email || "").trim())) delete payload.email;
      if (!edit.id && edit.tempPw) { const pw = randomPassword(); payload.passHash = await sha256Hex(pw); const r = await rpc("users.save", payload); setTempPw({ user: r.user, pw }); }
      else if (!edit.id) { await rpc("users.save", payload); toast("Account created. They sign in with a code sent to their email."); }
      else { await rpc("users.save", payload); toast("Saved."); }
      setEdit(null); reload();
    } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const getCode = async (u) => {
    setBusy(true);
    try { const r = await rpc("users.loginCode", { id: u.id }); setCodeFor({ user: u, ...r }); } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const doReset = async () => {
    setBusy(true);
    try { const pw = randomPassword(); await rpc("users.resetPassword", { id: resetFor.id, passHash: await sha256Hex(pw) }); setTempPw({ user: resetFor, pw }); setResetFor(null); } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const days = useMemo(() => { const out = []; let d = range.from; let guard = 0; while (d <= range.to && guard++ < 62) { out.push(d); d = addDaysISO(d, 1); } return out; }, [range.from, range.to]);
  const prodBy = useMemo(() => { const m = {}; (prod.data ? prod.data.rows : []).forEach((r) => { m[r.user_id] = m[r.user_id] || { name: r.user_name, days: {}, n: 0, amt: 0, resolved: 0 }; m[r.user_id].days[r.day] = r; m[r.user_id].n += r.n; m[r.user_id].amt += r.amt; m[r.user_id].resolved += r.resolved; }); return m; }, [prod.data]);
  const info = useRpc("meta.info", {}, []);
  const [testTo, setTestTo] = useState(me.email);
  const [testing, setTesting] = useState(false);
  const sendTest = async () => { setTesting(true); try { const r = await rpc("email.test", { to: testTo }); toast(`Test email sent to ${r.to} through ${r.provider}. Check the inbox (and spam).`); } catch (e) { toast(e.message, "err"); } setTesting(false); };
  const PROVIDER_LABEL = { graph: "Microsoft 365 (Graph)", resend: "Resend", brevo: "Brevo", sendgrid: "SendGrid", webhook: "webhook" };
  const tSort = useTableSort("name");
  const shownUsers = tSort.sortRows(ctx.users.filter((u) => { const q = find.trim().toLowerCase(); return !q || [u.name, u.email, u.emp_id, u.designation, u.department, u.reports_to_name, projectsText(u.projects)].join(" ").toLowerCase().includes(q); }),
    { projects: (u) => projectsText(u.projects), role: (u) => (u.is_admin ? "Admin" : u.role === "supervisor" ? "Team lead" : "Biller"), status: (u) => (u.active ? (u.roster_status || "active") : "zz inactive") });
  return (
    <div className="stack">
      <div className="row between"><div><h1>Team</h1><div className="sub">Team leads upload and allocate; billers work their day list one claim at a time.</div></div>
        <RosterSyncButton onDone={reload} />
        <div className="row"><input className="input sm" style={{ width: 220 }} placeholder="find a person, project, manager…" value={find} onChange={(e) => setFind(e.target.value)} />{me.is_admin && <button className="btn primary" onClick={() => setEdit({ first_name: "", last_name: "", email: "", designation: "SME", role: "user", capacity: 35, active: true, tempPw: false, projects_text: "", reports_to: "" })}>Add team member</button>}</div></div>
      <div className={"card tight row between " + (info.data && !info.data.email ? "" : "")} style={info.data && !info.data.email ? { borderLeft: "4px solid var(--amber)" } : { borderLeft: "4px solid var(--green)" }}>
        <div className="small">
          <b>Sign-in emails:</b> {!info.data ? "checking…" : info.data.email ? <>sent through <b>{PROVIDER_LABEL[info.data.email_provider] || info.data.email_provider}</b>{info.data.email_sender ? <> from <span className="mono">{info.data.email_sender}</span></> : info.data.email_from ? <> as <span className="mono">{info.data.email_from}</span></> : null}.</> : DEMO ? <>demo mode sends nothing; codes are shown on screen.</> : <>not set up on the Worker yet (EMAIL_PROVIDER). Billers cannot receive codes until it is; hand out codes from this list meanwhile. Setup steps are in the README.</>}
        </div>
        {info.data && (info.data.email || DEMO) && <div className="row"><input className="input sm" style={{ width: 240 }} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} /><button className="btn sm" disabled={testing || !mailOk(testTo)} onClick={sendTest}>{testing ? "Sending…" : "Send a test email"}</button></div>}
      </div>
      <div className="card">
        <div className="table-wrap"><table className="t"><thead><tr>{tSort.Th("name", "Name")}{tSort.Th("designation", "Designation")}{tSort.Th("email", "Email")}{tSort.Th("role", "Role")}{tSort.Th("projects", "Projects")}{tSort.Th("reports_to_name", "Reports to")}{tSort.Th("capacity", "Claims / day", "r")}{tSort.Th("status", "Status")}{tSort.Th("last_login", "Last sign in")}<th></th></tr></thead>
          <tbody>{shownUsers.map((u) => <tr key={u.id}><td><b>{u.name}</b>{u.id === me.id && <span className="tiny muted"> (you)</span>}{u.emp_id ? <div className="tiny muted mono">{u.emp_id}{u.source === "roster" ? " · roster" : ""}</div> : null}</td><td className="small">{u.designation || "–"}{u.department ? <div className="tiny muted">{u.department}</div> : null}</td><td className="small">{u.email_missing ? <span className="badge amber">no email</span> : u.email}</td><td>{u.is_admin ? <span className="badge purple">Admin</span> : u.role === "supervisor" ? <span className="badge ink">Team lead</span> : <span className="badge">Biller</span>}{u.access_all ? <div className="tiny muted">every project</div> : null}</td><td className="small">{projectsText(u.projects) || "–"}</td><td className="small">{u.reports_to_name || "–"}</td><td className="num">{u.capacity}</td><td>{!u.active ? <span className="badge red">inactive</span> : u.must_change ? <span className="badge amber">temporary password</span> : <span className="badge green">active</span>}{u.roster_status && u.roster_status !== "Working" ? <div><span className={"badge " + (STATUS_TONE[u.roster_status.toLowerCase()] || "gray")}>{u.roster_status}</span></div> : null}{u.has_password ? null : <div className="tiny muted">code sign-in only</div>}</td><td className="small">{u.last_login ? fmtWhen(u.last_login) : "never"}</td>
            <td className="r" style={{ whiteSpace: "nowrap" }}><button className="btn sm" onClick={() => setEdit({ id: u.id, first_name: u.first_name || (u.name || "").split(" ")[0] || "", last_name: u.last_name || (u.name || "").split(" ").slice(1).join(" "), email: u.email_missing ? "" : u.email, email_missing: u.email_missing, designation: u.designation || "", role: u.role, capacity: u.capacity, active: u.active, projects_text: projectsText(u.projects), reports_to: u.reports_to || "", emp_id: u.emp_id || "", is_admin: u.is_admin })}>Edit</button> <button className="btn sm link" disabled={busy || !u.active} onClick={() => getCode(u)} title="Issue a one-time sign-in code to pass on when their email has not arrived">Sign-in code</button>{u.has_password ? <> <button className="btn sm link" onClick={() => setResetFor(u)}>Reset password</button></> : null}{me.is_admin && u.id !== me.id && <> <button className="btn sm link" style={{ color: "var(--red-ink)" }} onClick={() => setDelFor(u)}>Delete</button></>}</td></tr>)}</tbody></table></div>
      </div>
      <div className="card">
        <div className="row between"><div><h3>Productivity</h3><div className="sub">Claims worked per person per day (one note per claim worked)</div></div>
          <DateRange value={pr} onChange={setPr} label="" /></div>
        <ErrorBox error={prod.error} />
        <div className="table-wrap mt"><table className="t"><thead><tr><th>Team member</th>{days.map((d) => <th key={d} className="r">{d.slice(5)}</th>)}<th className="r">Total</th><th className="r">Resolved</th><th className="r">Balance touched</th></tr></thead>
          <tbody>{Object.entries(prodBy).map(([id, u]) => <tr key={id}><td><b>{u.name}</b></td>{days.map((d) => <td key={d} className="num">{u.days[d] ? u.days[d].n : ""}</td>)}<td className="num b">{fmtInt(u.n)}</td><td className="num">{fmtInt(u.resolved)}</td><td className="num">{fmtMoney(u.amt)}</td></tr>)}
            {prod.data && !Object.keys(prodBy).length && <tr><td colSpan={days.length + 4} className="muted">No claims worked in this range.</td></tr>}</tbody></table></div>
      </div>
      {delFor && <Confirm title={"Delete " + delFor.name + "?"} text="Their sign-in is removed and they are signed out. Claims on their desk go back to the pool. Notes they wrote stay in the claim history." confirmLabel="Delete" danger busy={busy} onYes={doDelete} onNo={() => setDelFor(null)} />}
      {edit && (
        <Modal title={edit.id ? "Edit team member" : "New team member"} onClose={() => setEdit(null)} narrow footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy || !String(edit.first_name || "").trim() || (!edit.id && !String(edit.last_name || "").trim()) || ((!edit.id || edit.email) && !mailOk(edit.email))} onClick={save}>{busy ? "Saving…" : edit.id ? "Save" : "Create account"}</button></>}>
          <div className="stack">
            <div className="grid g2">
              <Field label="First name"><input className="input" value={edit.first_name} onChange={(e) => setEdit({ ...edit, first_name: e.target.value })} autoFocus /></Field>
              <Field label="Last name"><input className="input" value={edit.last_name} onChange={(e) => setEdit({ ...edit, last_name: e.target.value })} /></Field>
            </div>
            <Field label="Email" hint={edit.email_missing ? "The roster had no usable email for this person: add it here so they can sign in." : "Allowed: " + domainHint()}><input className="input" type="email" value={edit.email} disabled={!!edit.id && !me.is_admin && !edit.email_missing} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            {!edit.id && edit.email && mailOk(edit.email) && !domainOk(edit.email) && <div className="alert warn">That email's domain is not allowed (allowed: {domainHint()}).</div>}
            <div className="grid g2">
              <Field label="Designation"><Combo value={edit.designation} onChange={(v) => setEdit({ ...edit, designation: v })} placeholder="Pick…" options={DESIGNATIONS.map((d) => ({ id: d, label: d }))} /></Field>
              <Field label="Role in Brahmastra"><Combo clearable={false} value={edit.role} onChange={(v) => setEdit({ ...edit, role: v || "user" })} options={[{ id: "user", label: "Biller (works claims)" }, { id: "supervisor", label: "Team lead (allocates)" }]} /></Field>
            </div>
            {edit.id && <Field label="Emp ID (from Shastra)" hint="Matches this account to the roster: on the next roster load their name, email, projects and manager come from Shastra, their password stays, and any duplicate roster copy is switched off."><input className="input mono" placeholder="PHC000" value={edit.emp_id || ""} onChange={(e) => setEdit({ ...edit, emp_id: e.target.value })} /></Field>}
            <Field label="Projects" hint={"Separate with ; and add a share if any, e.g. VEC; NAEC 33%. Billers get these projects' claims; team leads see these projects."}><input className="input" value={edit.projects_text || ""} onChange={(e) => setEdit({ ...edit, projects_text: e.target.value })} /></Field>
            {edit.id && <PersonClientAccess userId={edit.id} ctx={ctx} me={me} />}
            <Field label="Reports to"><Combo value={edit.reports_to || ""} onChange={(v) => setEdit({ ...edit, reports_to: v })} placeholder="Nobody here" options={[{ id: "", label: "Nobody here" }, ...ctx.users.filter((u) => u.id !== edit.id && u.role === "supervisor").map((u) => ({ id: u.id, label: u.name, sub: u.designation || undefined }))]} /></Field>
            {edit.id && <div className="tiny muted">People from the roster: changes here last until the next roster load, which shows any difference before applying.</div>}
            <Field label="Claims per day" hint="Default capacity for allocation"><input className="input" type="number" min={1} max={500} value={edit.capacity} onChange={(e) => setEdit({ ...edit, capacity: e.target.value })} /></Field>
            {edit.id && <label className="check"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active (inactive people cannot sign in or receive claims)</label>}
            {!edit.id && <label className="check"><input type="checkbox" checked={!!edit.tempPw} onChange={(e) => setEdit({ ...edit, tempPw: e.target.checked })} /> Also give them a temporary password (shown once)</label>}
            {!edit.id && <div className="small muted">They sign in with a one-time code sent to this email each time. If their email is slow, you can issue a code from the Team list.</div>}
          </div>
        </Modal>
      )}
      {tempPw && (
        <Modal title="Temporary password" onClose={() => setTempPw(null)} narrow footer={<button className="btn primary" onClick={() => setTempPw(null)}>Done</button>}>
          <div className="stack">
            <div>Share this with <b>{tempPw.user.name}</b> ({tempPw.user.email}). It is shown only once; they will be asked to choose their own password at sign in.</div>
            <div className="pre" style={{ fontSize: 18, textAlign: "center" }}>{tempPw.pw}</div>
            <button className="btn sm" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(tempPw.pw).then(() => toast("Copied.")); }}>Copy</button>
          </div>
        </Modal>
      )}
      {resetFor && <Confirm title={`Reset ${resetFor.name}'s password?`} text="A new temporary password is generated and their current sessions are signed out." confirmLabel="Reset password" onYes={doReset} onNo={() => setResetFor(null)} busy={busy} />}
      {codeFor && (
        <Modal title={"Sign-in code for " + codeFor.user.name} onClose={() => setCodeFor(null)} narrow footer={<button className="btn primary" onClick={() => setCodeFor(null)}>Done</button>}>
          <div className="stack">
            <div>Pass this to <b>{codeFor.user.name}</b> ({codeFor.email}). On the sign-in screen they choose "Sign in with a code", enter their email, then this code. It works for {codeFor.expires_in_min} minutes and replaces any code emailed earlier.</div>
            <div className="pre mono" style={{ fontSize: 26, textAlign: "center", letterSpacing: 8 }}>{codeFor.code}</div>
            <button className="btn sm" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(codeFor.code).then(() => toast("Copied.")); }}>Copy</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- RACI tracker ---------- */
const RACI_COLS = [["r", "Responsible", "Does the work: the billers on the client."], ["a", "Accountable", "Owns the outcome: the team lead."],
  ["c", "Consulted", "Asked before decisions: the manager."], ["i", "Informed", "Kept up to date; the VP always, plus at most one more."]];
function RaciCell({ people, lockId }) {
  if (!people || !people.length) return <span className="tiny muted">nobody yet</span>;
  return <div className="pill-list" style={{ gap: 4 }}>{people.map((p) => <span key={p.id} className={"badge " + (lockId && p.id === lockId ? "ink" : "gray")} title={lockId && p.id === lockId ? "Always informed" : undefined}>{p.name}{lockId && p.id === lockId ? " · always" : ""}</span>)}</div>;
}
function PeoplePicker({ label, hint, value, onChange, people, cap, lockId }) {
  const opts = people.filter((p) => !value.some((v) => v.id === p.id)).map((p) => ({ id: p.id, label: p.name, sub: [p.designation, p.department].filter(Boolean).join(" · ") }));
  const add = (id) => { const p = id && people.find((x) => x.id === id); if (!p) return; if (value.length >= cap) { toast("At most " + cap + " here.", "err"); return; } onChange([...value, { id: p.id, name: p.name }]); };
  return (
    <Field label={label} hint={hint}>
      {value.length > 0 && <div className="pill-list" style={{ gap: 4, marginBottom: 6 }}>
        {value.map((p) => <span key={p.id} className={"badge " + (lockId === p.id ? "ink" : "gray")}>{p.name}{lockId === p.id ? " · always informed" : <button type="button" className="btn link sm" style={{ padding: "0 2px" }} onClick={() => onChange(value.filter((x) => x.id !== p.id))}>×</button>}</span>)}
      </div>}
      {value.length < cap ? <Combo value="" onChange={add} placeholder="Add a person…" options={opts} /> : <span className="tiny muted">full ({cap})</span>}
    </Field>
  );
}
function RaciEditModal({ row, people, vp, onClose, onSaved }) {
  const [d, setD] = useState({ r: row.r, a: row.a, c: row.c, i: row.i });
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try {
    await rpc("raci.save", { client_id: row.client_id, r: d.r.map((p) => p.id), a: d.a.map((p) => p.id), c: d.c.map((p) => p.id), i: d.i.map((p) => p.id) });
    toast("RACI saved."); onSaved(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  return (
    <Modal title={"RACI · " + row.client} onClose={onClose} narrow footer={<><button className="btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="stack">
        <PeoplePicker label="Responsible · does the work" hint="The billers working this client (up to 10)" value={d.r} onChange={(v) => setD({ ...d, r: v })} people={people} cap={10} />
        <PeoplePicker label="Accountable · owns the outcome" hint="Usually the team lead (up to 5)" value={d.a} onChange={(v) => setD({ ...d, a: v })} people={people} cap={5} />
        <PeoplePicker label="Consulted · asked before decisions" hint="Usually the manager (up to 5)" value={d.c} onChange={(v) => setD({ ...d, c: v })} people={people} cap={5} />
        <PeoplePicker label="Informed · kept up to date" hint={(vp ? vp.name + " (VP) is always informed; " : "") + "at most one more person"} value={d.i} onChange={(v) => setD({ ...d, i: v })} people={people} cap={2} lockId={vp && vp.id} />
      </div>
    </Modal>
  );
}
const MISSED_KINDS = { ar: ["AR", "Allocated before today and still not worked by the biller."],
  posting: ["Posting", "Past the TAT: still open, or finished late in the last 30 days."],
  submission: ["Submission", "Past the TAT (submission, recheck and rejections): still open, or finished late in the last 30 days."] };
function MissedModal({ row, kind, onClose }) {
  const q = useRpc("raci.missed", { client_id: row.client_id, kind }, [row.client_id, kind]);
  const rows = (q.data && q.data.rows) || [];
  const late = (h) => Math.max(1, Math.round(((h.done_at || Date.now()) - h.due_at) / 3600000));
  return (
    <Modal title={"Missed tasks · " + MISSED_KINDS[kind][0] + " · " + row.client} sub={MISSED_KINDS[kind][1]} onClose={onClose} wide
      footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      {!q.data ? <Spinner label="Loading…" /> : !rows.length ? <Empty>Nothing missed right now.</Empty> : (
        <div className="table-wrap"><table className="t">
          {kind === "ar" ? <>
            <thead><tr><th>Patient</th><th>Claim #</th><th>Payer</th><th>Balance</th><th>Biller</th><th>Allocated</th><th>Status</th></tr></thead>
            <tbody>{rows.map((c) => <tr key={c.id}><td className="b">{c.patient || "–"}</td><td className="mono">{c.claim_no}</td><td>{c.payer || "–"}</td><td className="mono">{fmtMoney(c.balance)}</td><td>{c.who || "–"}</td><td className="small">{fmtWhen(c.assigned_at)}</td><td><StateBadge state={c.state} /></td></tr>)}</tbody>
          </> : <>
            <thead><tr><th>Patient</th><th>Claim #</th><th>Step</th><th>With</th><th>Due</th><th>Finished</th><th>Late by</th></tr></thead>
            <tbody>{rows.map((h) => <tr key={h.id}><td className="b">{h.patient || "–"}</td><td className="mono">{h.claim_no}</td><td>{DEPT_NAME[h.dept] || h.dept}</td><td>{h.who || "–"}</td><td className="small">{fmtWhen(h.due_at)}</td><td className="small">{h.done_at ? fmtWhen(h.done_at) : <span className="badge amber">still open</span>}</td><td><span className="badge red">{late(h)}h late</span></td></tr>)}</tbody>
          </>}
        </table></div>)}
    </Modal>
  );
}
function RaciView({ me, go }) {
  const q = useRpc("raci.list", {}, []);
  const [edit, setEdit] = useState(null);
  const [missed, setMissed] = useState(null);
  const rows = q.data ? q.data.rows : [];
  const vp = q.data && q.data.vp;
  const people = (q.data && q.data.people) || [];
  return (
    <div className="stack">
      <div className="row between"><div><h1>RACI tracker</h1><div className="sub">Who is Responsible, Accountable, Consulted and Informed for each client. Everyone from SME up reads it; team leads and managers edit their own clients.{vp ? " " + vp.name + " (VP) is always informed." : ""}</div></div></div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{RACI_COLS.map(([k, l, h]) => <span key={k} className="badge gray" title={h}><b>{l[0]}</b> · {l}</span>)}</div>
      {!q.data ? <Spinner label="Loading…" /> : !rows.length ? <div className="card"><Empty>No active clients in your span yet.</Empty></div> : (
        <div className="card tight"><div className="table-wrap"><table className="t">
          <thead><tr><th>Client</th><th>R · Responsible</th><th>A · Accountable</th><th>C · Consulted</th><th>I · Informed</th><th title="AR: allocated before today, still not worked. Posting / Submission: past the TAT, open or finished late (30 days).">Missed tasks</th><th>Updated</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.client_id}>
              <td className="b" style={{ whiteSpace: "nowrap" }}>{go ? <button type="button" className="btn link" style={{ padding: 0, fontWeight: 700 }} title="Open Client 360" onClick={() => go("client", { client_id: r.client_id })}>{r.client}</button> : r.client}</td>
              <td><RaciCell people={r.r} /></td>
              <td><RaciCell people={r.a} /></td>
              <td><RaciCell people={r.c} /></td>
              <td><RaciCell people={r.i} lockId={vp && vp.id} /></td>
              <td style={{ whiteSpace: "nowrap" }}>{[["ar", "AR"], ["posting", "Post"], ["submission", "Sub"]].map(([k, l]) => { const n = (r.missed && r.missed[k]) || 0; return (
                <button key={k} className="btn link sm" style={{ padding: "0 4px" }} title={MISSED_KINDS[k][1] + (n ? " Click for the claims." : "")} disabled={!n} onClick={() => setMissed({ row: r, kind: k })}>
                  <span className={"badge " + (n ? "red" : "gray")}>{l} {n}</span></button>); })}</td>
              <td className="small muted" style={{ whiteSpace: "nowrap" }}>{r.saved ? <>{fmtWhen(r.updated_at)}<div className="tiny">{r.updated_by_name}</div></> : <span className="tiny">from the roster</span>}</td>
              <td style={{ textAlign: "right" }}>{r.can_edit ? <button className="btn sm" onClick={() => setEdit(r)}>Edit</button> : <span className="tiny muted" title="This client's team leads and managers edit it; you read it.">view</span>}</td>
            </tr>))}</tbody>
        </table></div></div>)}
      {edit && <RaciEditModal row={edit} people={people} vp={vp} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); q.reload(); }} />}
      {missed && <MissedModal row={missed.row} kind={missed.kind} onClose={() => setMissed(null)} />}
    </div>
  );
}

/* ---------- Feedback: anyone sends it from the tab on the right, with a screenshot and snippets; it is emailed to
   Shreya and Sweety (or whoever the admin picks) and kept in their Feedback inbox. ---------- */
const FB_KINDS = [["bug", "Something is wrong"], ["idea", "I have an idea"], ["praise", "This helped me"]];
const FB_HINT = { bug: "What were you doing, what happened, and what did you expect instead?", idea: "What would make your work easier? Where in Brahmastra?", praise: "What helped? It is good to know what to keep." };
const FB_TYPES = /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/;
let H2C_P = null;
function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (!H2C_P) H2C_P = new Promise((res, rej) => {
    const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    sc.onload = () => res(window.html2canvas); sc.onerror = () => { H2C_P = null; rej(new Error("The screenshot tool could not load. Paste a snippet instead: Win+Shift+S, then Ctrl+V.")); };
    document.head.appendChild(sc);
  });
  return H2C_P;
}
const blobToB64 = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(new Error("A file could not be read.")); r.readAsDataURL(b); });
const canvasToJpeg = (c, name) => new Promise((res) => c.toBlob((b) => res(new File([b], name, { type: "image/jpeg" })), "image/jpeg", 0.85));
/* Big pictures are made smaller (1800 px wide, JPEG) so the email stays light; GIFs and PDFs go as they are. */
async function shrinkPicture(file) {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(file.name + " is not a picture that can be read.")); i.src = url; });
    const k = Math.min(1, 1800 / img.naturalWidth);
    if (k === 1 && file.size < 600000) return file;
    const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return await canvasToJpeg(c, file.name.replace(/\.\w+$/, "") + ".jpg");
  } finally { URL.revokeObjectURL(url); }
}
/* What is on screen now, including the Sasha's Third Eye or SLA page in its frame (same web address). */
async function captureScreen(mask) {
  const h2c = await loadHtml2canvas();
  const W = window.innerWidth, H = window.innerHeight, scale = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1, 1800 / W));
  const opts = (w, h, x, y, bg) => ({ x, y, width: w, height: h, windowWidth: w, windowHeight: h, scale, useCORS: true, logging: false, backgroundColor: bg,
    // Gradient text (the logo) draws as a solid block in screenshots, so it is given a plain colour in the copy.
    onclone: (d) => { d.querySelectorAll(".wordmark .g, .wordmark .b").forEach((e) => { e.style.background = "none"; e.style.webkitTextFillColor = "currentColor"; e.style.color = e.classList.contains("g") ? "#12B886" : ""; }); if (mask) maskPhi(d); },
    ignoreElements: (el) => !!(el.classList && (el.classList.contains("fb-tab") || el.classList.contains("toast") || el.classList.contains("overlay"))) });
  const base = await h2c(document.body, opts(W, H, window.scrollX, window.scrollY, getComputedStyle(document.body).backgroundColor));
  for (const fr of document.querySelectorAll("iframe")) {
    const r = fr.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= H || r.width < 60 || r.height < 60) continue;
    try {
      const d = fr.contentDocument, w = fr.contentWindow;
      if (!d || !d.body) continue;
      const sub = await h2c(d.body, opts(fr.clientWidth, fr.clientHeight, w.scrollX, w.scrollY, getComputedStyle(d.body).backgroundColor));
      base.getContext("2d").drawImage(sub, r.left * scale, r.top * scale, r.width * scale, r.height * scale);
    } catch (e) {}
  }
  const now = new Date(), pad = (n) => String(n).padStart(2, "0");
  return canvasToJpeg(base, `Screenshot ${todayISO()} ${pad(now.getHours())}.${pad(now.getMinutes())}.jpg`);
}
function FeedbackModal({ page, onClose }) {
  const [kind, setKind] = useState("bug");
  const [msg, setMsg] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [drag, setDrag] = useState(false);
  const [mask, setMask] = useState(true);
  const pickRef = useRef(null);
  const rec = useRpc("feedback.recipients", {}, []);
  const to = (rec.data && rec.data.people) || [];
  const add = async (list) => {
    const out = [];
    for (const f0 of list) {
      if (!FB_TYPES.test(f0.type)) { toast(f0.name + ": attach pictures (PNG, JPG, GIF, WebP) or a PDF.", "err"); continue; }
      try {
        const f = await shrinkPicture(f0);
        if (f.size > 1100000) { toast(f.name + " is larger than 1 MB. Send a smaller one.", "err"); continue; }
        out.push({ key: Math.random().toString(36).slice(2), file: f, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
      } catch (e) { toast(e.message, "err"); }
    }
    setFiles((x) => { const all = [...x, ...out]; if (all.length > 4) toast("Up to 4 files.", "err"); return all.slice(0, 4); });
  };
  useEffect(() => {
    const h = (e) => {
      const fl = [...((e.clipboardData && e.clipboardData.items) || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
      if (!fl.length) return;
      e.preventDefault();
      add(fl.map((f, i) => (/^image\.\w+$/i.test(f.name) || !f.name ? new File([f], "Snippet " + (i + 1) + "." + (f.type.split("/")[1] || "png"), { type: f.type }) : f)));
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, []);
  useEffect(() => () => files.forEach((x) => x.url && URL.revokeObjectURL(x.url)), []);
  const capture = async () => {
    setBusy("Taking the screenshot…"); setHidden(true);
    await new Promise((r) => setTimeout(r, 150));
    try { await add([await captureScreen(mask)]); } catch (e) { toast(e.message || "The screenshot did not work. Paste a snippet instead: Win+Shift+S, then Ctrl+V.", "err"); }
    setHidden(false); setBusy(null);
  };
  const send = async () => {
    setBusy("Sending…");
    try {
      const enc = await Promise.all(files.map(async (x) => ({ name: x.file.name, type: x.file.type, b64: await blobToB64(x.file) })));
      const r = await rpc("feedback.send", { kind, message: msg, page: page + " (" + (location.hash || "#/") + ")", version: APP_VERSION, agent: navigator.userAgent, screen: window.innerWidth + "x" + window.innerHeight, theme: themeNow(), files: enc });
      toast(r.sending && r.sending.length ? "Thank you. Sent to " + r.sending.join(" and ") + "." : r.emailed && r.emailed.length ? "Thank you. Sent to " + r.emailed.join(" and ") + "." : "Thank you. It is in the feedback inbox" + (r.email_error ? " (the email did not go out: " + r.email_error + ")" : "") + ".");
      onClose();
    } catch (e) { toast(e.message, "err"); setBusy(null); }
  };
  if (hidden) return null;
  const ok = msg.trim().length >= 8 && !busy;
  return (
    <Modal title="Send feedback" sub={to.length ? "Goes to " + to.map((u) => u.name).join(" and ") + ", by email and in their Feedback inbox." : "Goes to the Feedback inbox."} onClose={busy ? undefined : onClose}
      footer={<><button className="btn" onClick={onClose} disabled={!!busy}>Cancel</button><button className="btn primary" onClick={send} disabled={!ok}>{busy === "Sending…" ? "Sending…" : "Send feedback"}</button></>}>
      <div className="stack">
        <div className="seg2" role="radiogroup">{FB_KINDS.map(([k, l]) => <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>)}</div>
        <Field label="What is it about" hint={"At least a few words · page: " + page}><textarea className="textarea" style={{ minHeight: 110 }} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={FB_HINT[kind]} autoFocus /></Field>
        <div className={"fb-drop" + (drag ? " on" : "")} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); add([...e.dataTransfer.files]); }}>
          <button type="button" className="btn sm" disabled={!!busy || files.length >= 4} onClick={capture}>{busy === "Taking the screenshot…" ? busy : "📷 Capture this screen"}</button>
          <button type="button" className="btn sm" disabled={!!busy || files.length >= 4} onClick={() => pickRef.current && pickRef.current.click()}>📎 Attach pictures or a PDF</button>
          <input ref={pickRef} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" style={{ display: "none" }} onChange={(e) => { add([...e.target.files]); e.target.value = ""; }} />
          <span className="tiny muted">or paste a snippet here: <b>Win+Shift+S</b>, then <b>Ctrl+V</b> · up to 4 files</span>
          <label className="check small" style={{ flexBasis: "100%", marginTop: 4 }}><input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} /> Hide patient details in the screenshot <span className="tiny muted">(names, account and member numbers are covered with grey bars)</span></label>
          {!mask && <div className="alert warn" style={{ flexBasis: "100%", margin: 0 }}>The screenshot will show patient details as they are on screen, and it goes out by email. Leave this on unless the patient detail itself is the problem.</div>}
          <div className="tiny muted" style={{ flexBasis: "100%" }}>Pasted snippets and attached files go as they are: crop patient details out before pasting.</div>
        </div>
        {files.length > 0 && <div className="fb-files">{files.map((x) => (
          <div key={x.key} className="fb-file">{x.url ? <img src={x.url} alt={x.file.name} /> : <div className="pdf">PDF<div className="tiny muted" style={{ fontWeight: 400 }}>{x.file.name}</div></div>}
            <span className="n">{x.file.name}</span>
            <button type="button" className="x" title="Remove" onClick={() => { if (x.url) URL.revokeObjectURL(x.url); setFiles((f) => f.filter((y) => y.key !== x.key)); }}>✕</button></div>))}</div>}
      </div>
    </Modal>
  );
}
/* The feedback inbox, for the people feedback goes to (and admins). */
function FeedbackInbox({ ctx, me, refreshFb }) {
  const [show, setShow] = useState("new");
  const q = useRpc("feedback.list", { show }, [show]);
  const [img, setImg] = useState({});
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState("");
  const rows = (q.data && q.data.rows) || [];
  const counts = (q.data && q.data.counts) || {};
  const people = (q.data && q.data.recipients) || [];
  const open = async (f) => {
    try {
      const r = await rpc("feedback.file", { id: f.id });
      const bin = atob(r.b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([u8], { type: r.type }));
      if (r.type.startsWith("image/")) setImg((m) => ({ ...m, [f.id]: url })); else window.open(url, "_blank", "noopener");
    } catch (e) { toast(e.message, "err"); }
  };
  const mark = async (r, status) => { setBusy(true); try { await rpc("feedback.setStatus", { id: r.id, status }); q.reload(); refreshFb && refreshFb(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const setTo = async (ids) => { setBusy(true); try { await rpc("feedback.setRecipients", { ids }); toast("Saved."); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  return (
    <div className="stack">
      <div className="row between"><div><h1>Feedback inbox</h1><div className="sub">What people sent from the Feedback tab, newest first, with their screenshots and snippets. They also go by email to {people.map((u) => u.name).join(" and ") || "the feedback people"}; each card says whether its email went out.</div></div>
        <div className="seg2">{[["new", "New" + (counts.new ? " " + counts.new : "")], ["done", "Done"], ["all", "All"]].map(([k, l]) => <button key={k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>{l}</button>)}</div></div>
      {me.is_admin && <div className="card tight small row" style={{ gap: 8, flexWrap: "wrap" }}><b>Feedback goes to:</b>
        {people.map((u) => <span key={u.id} className="badge gray">{u.name} <button type="button" className="btn link sm" style={{ padding: "0 2px" }} disabled={busy || people.length < 2} title={people.length < 2 ? "Someone must get the feedback" : "Remove"} onClick={() => setTo(people.filter((x) => x.id !== u.id).map((x) => x.id))}>×</button></span>)}
        <span style={{ minWidth: 220 }}><Combo sm value={pick} onChange={(v) => { setPick(""); if (v) setTo([...people.map((x) => x.id), v]); }} placeholder="Add a person…" options={ctx.users.filter((u) => u.active && !people.some((x) => x.id === u.id)).map((u) => ({ id: u.id, label: u.name, sub: u.designation }))} /></span>
        <span className="tiny muted">Shreya and Sweety unless you pick others; only an admin changes this.</span></div>}
      {!q.data ? <Spinner label="Loading…" /> : !rows.length ? <div className="card"><Empty>{show === "new" ? "Nothing new. Feedback arrives here when someone uses the Feedback tab." : "Nothing here yet."}</Empty></div>
        : rows.map((r) => (
          <div key={r.id} className={"card fb-card " + r.kind}>
            <div className="row between top">
              <div><span className={"badge " + (r.kind === "bug" ? "red" : r.kind === "idea" ? "amber" : "teal")}>{r.kind_label}</span> <b>{r.user_name}</b> <span className="small muted">{r.user_email} · {fmtWhen(r.at)} · {r.page}</span></div>
              {r.status === "done" ? <span className="small muted">Done by {r.done_by_name} · {fmtWhen(r.done_at)} <button className="btn link sm" disabled={busy} onClick={() => mark(r, "new")}>reopen</button></span>
                : <button className="btn sm" disabled={busy} onClick={() => mark(r, "done")}>✓ Mark done</button>}
            </div>
            <div className="fb-msg">{r.message}</div>
            {r.files.length > 0 && <div className="fb-files">{r.files.map((f) => (
              <div key={f.id} className="fb-file" style={{ cursor: "pointer" }} onClick={() => (img[f.id] ? window.open(img[f.id], "_blank", "noopener") : open(f))} title={img[f.id] ? "Open full size" : "Show"}>
                {img[f.id] ? <img src={img[f.id]} alt={f.name} /> : <div className="pdf">{f.type === "application/pdf" ? "PDF" : "🖼 Show"}<div className="tiny muted" style={{ fontWeight: 400 }}>{f.name}</div></div>}
                <span className="n">{f.name}</span></div>))}</div>}
            <div className="tiny muted mt8">{r.emailed_to ? "Emailed to " + r.emailed_to : <span style={{ color: "var(--amber-ink, #9A6700)" }}>Not emailed{r.email_error ? ": " + r.email_error : ""}</span>}{r.context && r.context.version ? " · v" + r.context.version : ""}{r.context && r.context.screen ? " · " + r.context.screen : ""}</div>
          </div>))}
    </div>
  );
}
/* ---------- Team today (team leads): who is on what right now, pace, carried over, out today, one-click rebalance ---------- */
const TT_STATUS = { working: ["green", "Working"], idle: ["red", "Idle"], not_started: ["amber", "Not started"], done: ["teal", "Desk cleared"], out: ["gray", "Out today"] };
/* The live floor on Live status: each biller's status, the claim they have open (and for how long), pace today, on desk,
   closed today and left over (high priority / other), with Out today, Rebalance and the coaching card. A biller's name
   opens their claims; the claim number opens the claim. Managers and above see the billers grouped by team lead. */
const leftCell = (r) => !r.carried ? <span className="muted">0</span> : <span className="row" style={{ gap: 5, flexWrap: "nowrap" }}><b className="mono">{r.carried}</b>
  {r.left_high ? <span className="badge red">{r.left_high} high</span> : null}{r.left_other ? <span className="badge gray">{r.left_other} other</span> : null}</span>;
function groupByLead(rows, grouped) {
  if (!grouped) return [{ key: "", rows }];
  const g = new Map();
  for (const r of rows) { const k = r.lead_id || ""; if (!g.has(k)) g.set(k, { key: k, name: r.lead_name || "No team lead on the roster", rows: [] }); g.get(k).rows.push(r); }
  return [...g.values()].sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || a.name.localeCompare(b.name));
}
const SH_TONE = { present: "green", late: "amber", break: "amber", out: "gray", notin: "gray", missing: "red", absent: "red", leave: "blue", offclock: "gray", none: "gray" };
const SH_OFF_NOTE = { off: "", pending: "Shastra status shows in a moment.", not_set_up: "Shastra status shows once the live attendance feed is set up in Purview Shastra (dev/shastra-live-feed.sql).", error: "Purview Shastra did not answer just now; Shastra status will show again by itself.", stale: "Purview Shastra has not answered for over 10 minutes, so its status is not shown; it comes back by itself." };
const shCell = (r) => !r.shastra ? <span className="muted">–</span>
  : <><span className={"badge " + (SH_TONE[r.shastra.state] || "gray")}>{r.shastra.label}</span>{r.shastra.sub ? <div className={"tiny " + (r.shastra.state === "missing" ? "red-ink b" : "muted")}>{r.shastra.sub}</div> : null}</>;
function LiveFloor({ ctx, me, go, q, clientId, locId, grouped, filtered }) {
  const [busy, setBusy] = useState(false);
  const [outFor, setOutFor] = useState(null);
  const [closed, setClosed] = useState({});
  const [mode, setMode] = useState("tl");
  const byTl = grouped && mode === "tl";
  const [claim, setClaim] = useState(null);
  const rows = (q.data && q.data.rows) || [];
  const setOut = async (r, out, reason) => { setBusy(true); try { await rpc("team.setOut", { user_id: r.id, out, reason }); setOutFor(null); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const rebalance = async (r) => {
    setBusy(true);
    try { const x = await rpc("team.rebalance", { user_id: r.id }); toast(x.moved ? `Moved ${x.moved} of ${r.name}'s claims: ` + x.to.map((y) => y.name + " " + y.count).join(", ") + (x.left ? `. ${x.left} stayed (nobody on that client had room).` : ".") : "Nothing to move: no untouched claims, or nobody on those clients has room."); q.reload(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const shareOut = async (r) => {
    if (!window.confirm(`Share ${r.name}'s ${r.untouched} untouched claim${r.untouched === 1 ? "" : "s"} equally between the people logged in on the same clients, and mark ${r.name.split(" ")[0]} out today?`)) return;
    setBusy(true);
    try { const x = await rpc("team.shareOut", { user_id: r.id, today: todayISO() }); toast((x.moved ? `Shared ${x.moved}: ` + x.to.map((y) => y.name + " " + y.count).join(", ") + "." + (x.left ? ` ${x.left} stayed (nobody in on that client).` : "") : "No untouched claims to share.") + " Marked out today."); q.reload(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const missing = rows.filter((r) => r.status !== "out" && r.shastra && r.shastra.state === "missing");
  const shState = q.data && q.data.shastra_state;
  const groups = groupByLead(rows, byTl);
  const setAll = (open) => setClosed(open ? {} : Object.fromEntries(groups.map((g) => [g.key || "none", true])));
  return (
    <div className="card dash-team">
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}><div className="cv-sec" style={{ margin: 0 }}>On the floor now</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{grouped && <><div className="seg2">{[["tl", "By team lead"], ["one", "One list"]].map(([k, l]) => <button key={k} type="button" className={mode === k ? "on" : ""} onClick={() => setMode(k)}>{l}</button>)}</div>
          {byTl && <><button type="button" className="btn sm" onClick={() => setAll(true)}>Expand all</button><button type="button" className="btn sm" onClick={() => setAll(false)}>Collapse all</button></>}</>}
          <span className="small muted">click a name to open their claims, a claim number to open the claim</span></div></div>
      {q.error ? <div className="alert err mt8">{q.error}</div> : !q.data ? <div className="mt8"><Spinner label="Loading…" /></div> : !rows.length ? <div className="mt8"><Empty>{filtered ? "Nobody here for this selection." : "Nobody on your team yet. Billers come from the roster and the clients' teams."}</Empty></div> : <>
        {missing.map((r) => <div key={r.id} className="sh-alert mt8"><div className="ic">⚠</div>
          <div style={{ flex: 1, minWidth: 240 }}><b className="red-ink">{r.name} has not logged in to Shastra</b><div className="small">Shift {r.shift} · {r.shastra.sub} · no leave, week off or holiday in Shastra. May be absent. <b>{fmtInt(r.untouched)} claim{r.untouched === 1 ? "" : "s"}</b> on their desk {r.untouched === 1 ? "is" : "are"} not started.</div></div>
          {r.untouched > 0 && <button type="button" className="btn primary" disabled={busy} onClick={() => shareOut(r)}>Reallocate {fmtInt(r.untouched)} equally</button>}
          <button type="button" className="btn" disabled={busy} onClick={() => setOutFor({ r, reason: "Not logged in to Shastra" })}>Mark out today</button></div>)}
        <div className="table-wrap mt8"><table className="t">
          <thead><tr><th>Biller</th><th title="From Purview Shastra, read every 2 minutes">Shastra</th><th>Now</th><th>Working on</th><th>Pace today</th><th className="num">On desk</th><th className="num">Closed today</th><th title="Allocated before this shift and not worked yet">Left over</th><th /></tr></thead>
          <tbody>{groups.map((g) => { const open = !closed[g.key || "none"]; return <React.Fragment key={g.key || "none"}>
            {byTl && <tr className="lead-grp click" onClick={() => setClosed((c) => ({ ...c, [g.key || "none"]: open }))}><td colSpan={9}><span className="caret">{open ? "▾" : "▸"}</span> <b>{g.name}</b> <span className="muted">· {plural(g.rows.length, "biller")}{g.rows.some((r) => r.status === "out") ? " · " + g.rows.filter((r) => r.status === "out").length + " out today" : ""}{g.rows.some((r) => r.shastra && r.shastra.state === "missing") ? " · " : ""}</span>{g.rows.some((r) => r.shastra && r.shastra.state === "missing") ? <span className="badge red">{g.rows.filter((r) => r.shastra && r.shastra.state === "missing").length} not logged in</span> : null}
              {!open && <span className="small muted"> · {g.rows.filter((r) => r.status === "working").length} working · {g.rows.filter((r) => r.status === "idle").length} idle · {g.rows.reduce((a, r) => a + r.on_desk, 0)} on desks</span>}</td></tr>}
            {(open || !byTl) && g.rows.map((r) => (
              <tr key={r.id}>
                <td><button type="button" className="btn link biller-link" style={{ padding: 0, fontWeight: 700 }} title={"Open " + r.name + "'s claims"} onClick={() => go("claims", { assigned_to: r.id, clientId, locationId: locId, state: "" })}>{r.name} ›</button><div className="tiny muted">{(r.shift || "no shift on the roster") + " · target\u00a0" + r.capacity}</div></td>
                <td className="sh-cell">{shCell(r)}</td>
                <td><span className={"badge " + TT_STATUS[r.status][0]}>{TT_STATUS[r.status][1]}{r.status === "idle" && r.idle_min != null ? " · " + r.idle_min + " min" : ""}</span></td>
                <td style={{ minWidth: 190 }}>{r.current ? <><button type="button" className="btn link mono" style={{ padding: 0 }} onClick={() => setClaim(r.current.id)}>{r.current.claim_no || "claim"}</button>{r.current.minutes != null ? <span className="small muted"> · {r.current.minutes} min</span> : null}<div className="tiny muted">{[r.current.client, r.current.payer, r.current.balance != null ? fmtMoney(r.current.balance) : ""].filter(Boolean).join(" · ")}</div></>
                  : r.out ? <span className="tiny muted">{r.out.reason || "marked out"} · by {r.out.by}</span> : r.last ? <span className="tiny muted">no claim open · last entry {new Date(r.last).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span> : <span className="tiny muted">–</span>}</td>
                <td style={{ minWidth: 180 }}>{r.status === "out" ? <span className="tiny muted">–</span> : <><div className="row" style={{ gap: 8 }}><div className="bar" style={{ flex: 1, minWidth: 90 }}><i style={{ width: Math.min(100, r.worked / Math.max(1, r.capacity) * 100) + "%", background: r.behind ? "#E8A13C" : undefined }} /></div><b className="small">{r.worked}</b><span className="tiny muted">/ {r.capacity}</span></div>
                  <div className={"tiny " + (r.behind ? "amber-ink" : "muted")}>{r.expected ? (r.behind ? "behind: about " + r.expected + " expected by now" : "on pace (" + r.expected + " expected by now)") : r.worked ? "just started" : "shift not started"}{r.skips ? " · " + r.skips + " skipped" : ""}</div></>}</td>
                <td className="num">{r.on_desk}</td>
                <td className="num">{r.closed || <span className="muted">0</span>}</td>
                <td>{leftCell(r)}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {r.status === "out" ? <><button className="btn sm" disabled={busy} onClick={() => setOut(r, false)}>In after all</button> {r.untouched > 0 && <button className="btn sm primary" disabled={busy} title="Share the untouched claims equally between the people in today on the same clients" onClick={() => rebalance(r)}>Rebalance {r.untouched}</button>}</>
                    : <>{r.shastra && r.shastra.state === "missing" && r.untouched > 0 && <button className="btn sm primary" disabled={busy} onClick={() => shareOut(r)}>Reallocate {r.untouched}</button>}{" "}<button className="btn sm" disabled={busy} onClick={() => setOutFor({ r, reason: "" })}>Out today</button></>}
                </td>
              </tr>))}
          </React.Fragment>; })}</tbody></table></div>
        <div className="tiny muted mt8">Shastra is each person's attendance in Purview Shastra now (late is 10 minutes past the shift start; not logged in is an hour past it with no punch in, leave, week off or holiday){shState && shState !== "ok" && SH_OFF_NOTE[shState] ? ". " + SH_OFF_NOTE[shState] : "."} Pace compares entries this shift with the target spread over the shift from the roster. Left over is what was allocated before this shift and is still not worked; high priority is the High tier. Rebalance and Reallocate share the untouched claims equally between the people in today on the same client, high priority first.</div>
      </>}
      {outFor && <Modal title={"Out today · " + outFor.r.name} narrow onClose={() => setOutFor(null)} footer={<><button className="btn" onClick={() => setOutFor(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => setOut(outFor.r, true, outFor.reason)}>Mark out</button></>}>
        <div className="stack"><Field label="Reason (optional)"><Combo value={outFor.reason} onChange={(v) => setOutFor({ ...outFor, reason: v })} placeholder="Pick or leave empty…" options={["Leave", "Sick", "Half day", "Training", "Other work"].map((x) => ({ id: x, label: x }))} /></Field>
          <div className="small muted">Then use Rebalance to hand their {outFor.r.on_desk} claims to the people in today. A half day counts 4 hours of floor time on Team status.</div></div></Modal>}
      {claim && <ClaimDrawer id={claim} ctx={ctx} me={me} onClose={() => setClaim(null)} onChanged={() => q.reload()} />}
    </div>
  );
}
const COACH_KIND = [["one_to_one", "1:1"], ["praise", "Praise"], ["concern", "Concern"], ["goal", "Goal"]];
function CoachDrawer({ userId, onClose }) {
  const q = useRpc("coach.profile", { user_id: userId }, [userId]);
  const [n, setN] = useState({ kind: "one_to_one", text: "" });
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const add = async () => { setBusy(true); try { await rpc("coach.noteAdd", { user_id: userId, ...n }); setN({ kind: n.kind, text: "" }); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const del = async (x) => { setBusy(true); try { await rpc("coach.noteDelete", { id: x.id }); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const maxDay = d ? Math.max(1, d.person.capacity, ...d.days.map((x) => x.work)) : 1;
  // one slot per calendar day, so a short history does not stretch across the chart
  const slots = useMemo(() => { if (!d) return []; const by = new Map(d.days.map((x) => [x.day, x])); const t0 = todayISO(); return Array.from({ length: 30 }, (_, i) => { const day = addDaysISO(t0, i - 29); return by.get(day) || { day, work: 0, skips: 0 }; }); }, [d]);
  return (
    <Modal title={d ? "Coaching · " + d.person.name : "Coaching"} sub={d ? [d.person.designation, d.person.reports_to_name ? "reports to " + d.person.reports_to_name : "", d.person.shift, "target " + d.person.capacity + " a day"].filter(Boolean).join(" · ") : ""} wide onClose={onClose}>
      {q.error ? <div className="alert err">{q.error}</div> : !d ? <Spinner label="Loading…" /> : <div className="stack">
        <div className="c3-kpis">
          <Kpi tone="accent" label="Entries a day" value={d.avg_per_day} sub={"on " + d.worked_days + (d.worked_days === 1 ? " day" : " days") + " worked · target " + d.person.capacity} />
          <Kpi label="Entries · 30 days" value={fmtInt(d.entries)} sub={d.skips + " skipped"} />
          <Kpi label="Carried over" value={<span className={d.carried ? "amber-ink" : ""}>{d.carried}</span>} sub="allocated over a day ago" />
          <Kpi label="Escalated" value={d.escalations} sub="to the team lead" />
          <Kpi label="Handed back" value={<span className={d.handed_back ? "amber-ink" : ""}>{d.handed_back}</span>} sub={"of " + d.handoffs_sent + " sent to posting / submission"} />
          <Kpi label="Note length" value={d.note_len} sub={"characters on average" + (d.out_days ? " · " + d.out_days + " days out" : "")} />
        </div>
        <div className="card tight"><div className="b small mb">Entries a day, last 30 days</div>
          {d.days.length ? <div className="coach-days">{slots.map((x) => <div key={x.day} title={fmtDate(x.day) + ": " + x.work + " entries" + (x.skips ? ", " + x.skips + " skipped" : "")}><i style={{ height: (x.work ? Math.max(2, x.work / maxDay * 100) : 0) + "%", background: x.work >= d.person.capacity ? "var(--teal)" : x.work >= d.person.capacity * 0.8 ? "#E8A13C" : "#C94F4F" }} /></div>)}
            <span className="coach-target" style={{ bottom: d.person.capacity / maxDay * 100 + "%" }} title={"target " + d.person.capacity} /></div> : <Empty>No entries in the last 30 days.</Empty>}
          {d.statuses.length > 0 && <div className="tiny muted mt8">Most entered: {d.statuses.map((x) => x.status + " (" + x.n + ")").join(" · ")}. QA scores are in Sasha's Third Eye › Internal reports.</div>}</div>
        <div className="card tight"><div className="row between"><div className="b small">1:1 notes</div><span className="tiny muted">seen by team leads and up, never by the biller</span></div>
          <div className="row mt8" style={{ gap: 6, flexWrap: "wrap" }}><div className="seg2">{COACH_KIND.map(([k, l]) => <button key={k} className={n.kind === k ? "on" : ""} onClick={() => setN({ ...n, kind: k })}>{l}</button>)}</div></div>
          <div className="row mt8" style={{ gap: 6 }}><textarea className="textarea" style={{ minHeight: 54, flex: 1 }} value={n.text} onChange={(e) => setN({ ...n, text: e.target.value })} placeholder="What was discussed, agreed or worth keeping in mind" />
            <button className="btn primary" disabled={busy || n.text.trim().length < 8} onClick={add}>Add</button></div>
          {d.notes.map((x) => <div key={x.id} className="c3-log mt8"><b>{(COACH_KIND.find(([k]) => k === x.kind) || ["", x.kind])[1]} · {fmtWhen(x.at)} · {x.by_name}{x.mine && <button className="btn link sm" style={{ padding: "0 4px" }} disabled={busy} onClick={() => del(x)}>remove</button>}</b><div>{x.text}</div></div>)}
          {!d.notes.length && <div className="tiny muted mt8">No notes yet.</div>}</div>
      </div>}
    </Modal>
  );
}
/* Note templates: team leads write them, billers insert them into RCA / findings. */
function TemplatesView({ ctx, me }) {
  const q = useRpc("templates.list", {}, []);
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = (q.data && q.data.rows) || [];
  const canEdit = !isSmeUI(me);
  const save = async () => { setBusy(true); try { await rpc("templates.save", edit); toast("Saved."); setEdit(null); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const del = async (r) => { setBusy(true); try { await rpc("templates.delete", { id: r.id }); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  return (
    <div className="stack">
      <div className="row between"><div><h1>Note templates</h1><div className="sub">Text billers insert into RCA / findings with one click, for every client or one. Keep them short and fill in the blanks after inserting.</div></div>
        {canEdit && <button className="btn primary" onClick={() => setEdit({ title: "", text: "", client_id: "" })}>New template</button>}</div>
      {q.error ? <div className="alert err">{q.error}</div> : !q.data ? <Spinner label="Loading…" /> : !rows.length ? <div className="card"><Empty>No templates yet.{canEdit ? " Add the notes your team types most often." : ""}</Empty></div> :
        <div className="card tight"><div className="table-wrap"><table className="t"><thead><tr><th>Title</th><th>Text</th><th>Client</th><th>By</th><th /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="b">{r.title}</td><td className="small" style={{ maxWidth: 520, whiteSpace: "pre-wrap" }}>{r.text}</td><td className="small">{r.client_name || "every client"}</td><td className="small">{r.by_name}<div className="tiny muted">{fmtWhen(r.at)}</div></td>
            <td style={{ whiteSpace: "nowrap" }}>{canEdit && <><button className="btn sm" onClick={() => setEdit({ id: r.id, title: r.title, text: r.text, client_id: r.client_id || "" })}>Edit</button> <button className="btn sm link" style={{ color: "var(--red-ink)" }} disabled={busy} onClick={() => del(r)}>Delete</button></>}</td></tr>)}</tbody></table></div></div>}
      {edit && <Modal title={edit.id ? "Edit template" : "New template"} narrow onClose={() => setEdit(null)} footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" disabled={busy || edit.title.trim().length < 3 || edit.text.trim().length < 8} onClick={save}>Save</button></>}>
        <div className="stack">
          <Field label="Title" hint="What billers see in the list"><input className="input" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="e.g. Claim in process, call back in 15 days" autoFocus /></Field>
          <Field label="Text" hint="Inserted into RCA / findings; leave blanks like [ref] to fill in"><textarea className="textarea" style={{ minHeight: 110 }} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} placeholder="Called the payer, claim is in process since [date], expected to finalize in [n] days. Ref [ref]." /></Field>
          <Field label="Client"><Combo value={edit.client_id} onChange={(v) => setEdit({ ...edit, client_id: v })} placeholder="Every client" options={ctx.clients.filter((c) => c.active && c.can_edit !== false).map((c) => ({ id: c.id, label: c.name }))} /></Field>
        </div></Modal>}
    </div>
  );
}
/* ---------- Portfolio (VP, admins, managers): every client worst first, managers side by side, data freshness ---------- */
const HEALTH_UI = { good: ["green", "On track"], watch: ["amber", "Needs attention"], risk: ["red", "At risk"] };
const isPortfolioUser = (me) => !!me && me.role === "supervisor" && (me.is_admin || me.access_all || me.roster_kind === "manager");
/* Dashboard > Inventory status: what was the Portfolio, for team leads too (their own clients): every client worst first,
   with the reasons, unassigned and collected for the dates; the claims in detail; managers side by side and data freshness. */
const DR_BAND = { ok: ["teal-ink", "green", "Green"], warn: ["amber-ink", "amber", "Amber"], miss: ["red-ink", "red", "Red"] };
const drBandUi = (b) => DR_BAND[b] || ["muted", "gray", "Not scored"];
const drDot = (b) => <i className={"psla-dot " + (b || "none")} />;
/* Dashboard › Inventory status: where every workable claim stands today (one stage each), the age of the AR against the over-90
   target, the pace to clear, the SLA checks the inventory answers today, and what to do first to meet the SLA. Every client, or one. */
const INV_STAGES = [["open", "Unassigned", "#9AA5B1"], ["list", "On a biller's list", "#22CAE4"], ["later", "Worked, follow-up later", "#30C48D"], ["due", "Follow-up due today", "#F5A623"],
  ["overdue", "Follow-up overdue", "#E5484D"], ["waiting", "Waiting on the client", "#7C5CFF"], ["desk", "At Posting / Submission", "#2563EB"]];
const fmtK = (v) => { const a = Math.abs(Number(v) || 0); return "$" + (a >= 1e6 ? (Math.round(a / 1e4) / 100) + "M" : a >= 1e4 ? Math.round(a / 1e3) + "k" : a >= 1e3 ? (Math.round(a / 100) / 10) + "k" : Math.round(a)); };
function InvStrip({ stages, mini }) {
  const tot = INV_STAGES.reduce((t, [k]) => t + (stages[k] ? stages[k].n : 0), 0);
  if (!tot) return <div className={mini ? "inv-mini" : "inv-strip"} style={{ background: "var(--soft)" }} />;
  return <div className={mini ? "inv-mini" : "inv-strip"}>{INV_STAGES.map(([k, l, c]) => stages[k] && stages[k].n ? <i key={k} title={l + ": " + stages[k].n} style={{ width: (stages[k].n / tot * 100) + "%", background: c }} /> : null)}</div>;
}
function InventoryStatusTab(props) {
  const { ctx, go } = props;
  const [clientId, setClientId] = useState(""), [leadId, setLeadId] = useState("");
  const leadsQ = useRpc("team.leads", {}, []);
  const canLead = !!(leadsQ.data && leadsQ.data.can_pick_lead && leadsQ.data.leads.length);
  const q = useRpc("inventory.status", { client_id: clientId || undefined, lead_id: leadId || undefined, today: todayISO() }, [clientId, leadId]);
  const d = q.data;
  const ago = (ms) => { if (!ms) return "never"; const dd = Math.floor((Date.now() - ms) / 86400000); return dd <= 0 ? "today" : dd === 1 ? "yesterday" : dd + " days ago"; };
  const stageSub = (k, s) => k === "open" ? (d.oldest_open == null ? "" : d.oldest_open ? "oldest " + plural(d.oldest_open, "day") : "added today") : k === "list" ? plural(d.list_people, "biller") : k === "later" ? (d.next_fu ? "next due " + fmtMDY(d.next_fu) : "")
    : k === "overdue" ? (d.o7 ? d.o7 + " over 7 days" : "") : k === "waiting" ? (d.w10 ? d.w10 + " over 10 days" : "") : k === "desk" ? (d.late ? d.late + " past TAT" : "") : "";
  const maxAge = d ? Math.max(1, ...d.ages.map((a) => a.bal)) : 1;
  const BAR = 96, barH = (v) => Math.max(2, v / maxAge * BAR), tLine = d && d.ar ? 34 + Math.min(BAR, d.target / 100 * d.ar / maxAge * BAR) : 0;
  const pc = d && d.pace;
  const reds = d ? d.insights.filter((i) => i.tone === "red").length : 0;
  const run = (a) => go(a.to, a.params);
  const client = clientId && d ? d.clients.find((c) => c.client_id === clientId) : null;
  return (
    <div className="stack inv" style={{ gap: 12 }}>
      <div className="card">
        <div className="row dash-filters" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
          <div style={{ minWidth: 230 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} allowAll /></div>
          {canLead && <div style={{ minWidth: 210 }}><Field label="Team lead"><Combo value={leadId} onChange={setLeadId} placeholder="All team leads" options={leadsQ.data.leads.map((l) => ({ id: l.id, label: l.name + " · " + plural(l.n, "biller") }))} /></Field></div>}
          {d && <div className="small muted" style={{ marginLeft: "auto", textAlign: "right" }}>{plural(d.clients.length, "client")} · last inventory upload <b>{ago(d.last_inventory)}</b><br />Month-end in <b>{plural(d.wd_left, "working day")}</b></div>}
        </div>
        {q.error ? <ErrorBox error={q.error} /> : !d ? <Spinner label="Reading the inventory…" /> : <>
          <div className="row between" style={{ marginTop: 14, flexWrap: "wrap" }}><div><span className="inv-lbl">Where the inventory stands</span> <span className="small muted">· {plural(INV_STAGES.reduce((t, [k]) => t + d.stages[k].n, 0), "workable claim")} · {fmtK(INV_STAGES.reduce((t, [k]) => t + d.stages[k].bal, 0))}</span></div>
            <span className="small muted">Closed this month: <b className="teal-ink">{plural(d.closed.n, "claim")} · {fmtK(d.closed.bal)}</b></span></div>
          <InvStrip stages={d.stages} />
          <div className="inv-legend">{INV_STAGES.map(([k, l, c]) => <button type="button" key={k} style={{ borderColor: c }} onClick={() => k === "open" ? go("allocate", clientId ? { clientId } : {}) : go("claims", { clientId, stage: k, state: "" })}>
            <b>{fmtInt(d.stages[k].n)}</b><span>{l}</span><small>{fmtK(d.stages[k].bal)}{stageSub(k) ? " · " + stageSub(k) : ""}</small></button>)}</div>
        </>}
      </div>
      {d && <>
        <div className="inv-k3">
          <div className="card"><span className="inv-lbl">Age of the workable AR</span> <span className="small muted">· SLA: over 90 days ≤ {d.target}% · the dashed line is {d.target}% of the AR</span>
            <div className="inv-age"><div className="inv-tline" style={{ bottom: tLine }} title="The over-90 bucket must stay under this line" />
              {d.ages.map((a, k) => <div key={k}><b className={k === 3 && d.over90_pct > d.target ? "red-ink" : ""}>{fmtK(a.bal)}</b><i style={{ height: barH(a.bal), background: ["#30C48D", "#22CAE4", "#F5A623", d.over90_pct > d.target ? "#E5484D" : "#9AA5B1"][k] }} />
                <span className={k === 3 ? "b " + (d.over90_pct > d.target ? "red-ink" : "teal-ink") : ""}>{["0–30", "31–60", "61–90", "90+"][k]}<br />{d.ar ? Math.round(a.bal / d.ar * 1000) / 10 : 0}%</span></div>)}</div>
            <div className="small muted mt8">{d.over90_pct > d.target ? <>Over 90 days is <b className="red-ink">{d.over90_pct}%</b>, above the {d.target}% target. {d.insights[0] && /Over-90/.test(d.insights[0].title) ? <>Resolve the biggest <b>{d.insights[0].sub.split(" ")[0]}</b> claims over 90 days ({d.insights[0].num}) and it comes under.</> : null}</>
              : <>Over 90 days is <b className="teal-ink">{d.over90_pct}%</b>, within target. {d.ages[2].bal ? <>{fmtK(d.ages[2].bal)} is 61 to 90 days old: work it before it turns 90.</> : null}</>}</div></div>
          <div className="card"><span className="inv-lbl">Pace to clear</span> <span className="small muted">· last 2 weeks</span>
            <div className="inv-pace"><div className="inv-ring" style={{ background: `conic-gradient(${pc.days_to_clear == null ? "#9AA5B1" : pc.days_to_clear <= d.wd_left ? "var(--sc-g)" : "var(--sc-r)"} 0 ${pc.days_to_clear == null ? 0 : Math.min(100, d.wd_left / Math.max(1, pc.days_to_clear) * 100)}%, var(--soft) 0 100%)` }}>
              <div><b>{pc.days_to_clear == null ? "–" : pc.days_to_clear}</b><small>days to clear</small></div></div>
              <div><div><b>{fmtInt(pc.to_work)}</b> claims still to work</div><div className="small muted">{pc.per_day} a day · {plural(pc.people, "person", "people")} · {plural(d.wd_left, "working day")} left this month</div>
                {pc.days_to_clear == null ? <span className="badge gray mt8">No work in the last 2 weeks</span> : pc.days_to_clear <= d.wd_left ? <span className="badge green mt8">On track · {plural(d.wd_left - pc.days_to_clear, "day")} spare</span> : <span className="badge red mt8">{plural(pc.days_to_clear - d.wd_left, "day")} short</span>}
                {!clientId && (() => { const late = d.clients.filter((c) => c.days_to_clear != null && c.days_to_clear > d.wd_left); return late.length ? <div className="small muted mt8">Not on track: {late.slice(0, 3).map((c) => c.client + " (" + c.days_to_clear + " days)").join(", ")}{late.length > 3 ? " +" + (late.length - 3) : ""}</div> : null; })()}</div></div></div>
          <div className="card"><span className="inv-lbl">SLA checks · today</span> <span className="small muted">· from the inventory</span>
            {!d.clients.length ? <Empty>No clients yet, so there is nothing to check.</Empty> : <table className="inv-ck"><thead><tr><th>Check</th><th className="r">Now</th><th>Target</th><th></th></tr></thead>
              <tbody>{d.checks.map((c) => <tr key={c.key}><td>{c.name}</td><td className={"r b " + (c.ok ? "teal-ink" : c.warn ? "amber-ink" : "red-ink")}>{c.now}</td><td className="muted">{c.target}</td>
                <td>{c.ok ? <span className="badge green">met</span> : c.warn ? <span className="badge amber">watch</span> : <span className="badge red">not met</span>}</td></tr>)}</tbody></table>}
            {d.drishti && d.drishti.state === "ok" && d.drishti.avg != null && !clientId ? <div className="small muted mt8">Last scorecard in Drishti: average <b>{d.drishti.avg}%</b> · {d.drishti.bands.ok} green · {d.drishti.bands.warn} amber · {d.drishti.bands.miss} red</div>
              : client && client.drishti ? <div className="small muted mt8">Last scorecard in Drishti: <b className={drBandUi(client.drishti.band)[0]}>{client.drishti.score}%</b> <button type="button" className="btn link tiny" style={{ padding: 0 }} onClick={() => go("sla", { tab: "scorecard", client_id: clientId })}>scorecard ›</button></div> : null}</div>
        </div>
        <div className="card">
          <div className="row between" style={{ alignItems: "flex-start" }}><div><h3 style={{ margin: 0 }}>To meet the SLA this month · do these first</h3>
            <div className="small muted">Worked out from today's inventory, the targets and the team's pace{client ? " for " + client.client : ""}. Each one opens the claims, or hands them out.</div></div>
            {reds > 0 ? <span className="badge red">{reds} red</span> : <span className="badge green">nothing red</span>}</div>
          {!d.insights.length ? <Empty>Nothing in the inventory yet.</Empty> : <div className="inv-ins">{d.insights.map((i, k) => (
            <div key={k} className={"inv-it " + i.tone}><div className="inv-num"><b>{i.num}</b><small>{i.sub}</small></div>
              <div style={{ minWidth: 0 }}><div><b>{i.title}</b> {i.text}</div>{i.act.length > 0 && <div className="row mt8" style={{ gap: 6 }}>{i.act.map((a, j) => <button key={j} className={"btn sm" + (j ? "" : " primary")} onClick={() => run(a)}>{a.label}</button>)}</div>}</div></div>))}</div>}
        </div>
        {!clientId && d.clients.length > 0 && <div className="card tight"><div className="row between" style={{ padding: "12px 14px 0" }}><h3 style={{ margin: 0 }}>By client · worst first</h3><span className="small muted">Click a client for its own stages and do-first list</span></div>
          <div className="table-wrap"><table className="t"><thead><tr><th>Client · health</th><th>Team lead</th><th>Where the inventory stands</th><th className="num">Workable AR</th><th className="num">Over 90</th><th className="num">Overdue</th><th className="num">Waiting</th><th className="num">Days to clear</th><th>SLA · Drishti</th><th>Do first</th></tr></thead>
            <tbody>{d.clients.map((c) => <tr key={c.client_id} className={"click" + (c.health === "risk" ? " inv-risk" : "")} onClick={() => setClientId(c.client_id)}>
              <td style={{ minWidth: 200 }}><b>{c.client}</b> <span className={"badge " + HEALTH_UI[c.health][0]}>{HEALTH_UI[c.health][1]}</span></td><td className="small">{c.tl.join(", ") || "–"}</td>
              <td><InvStrip stages={c.stages} mini /></td><td className="num mono">{fmtK(c.ar)}</td><td className={"num " + (c.over90_pct > d.target ? "red-ink" : "teal-ink")}>{c.over90_pct}%</td>
              <td className={"num " + (c.overdue ? "red-ink" : "")}>{fmtInt(c.overdue)}</td><td className="num">{fmtInt(c.waiting)}</td>
              <td className={"num " + (c.days_to_clear != null && c.days_to_clear > d.wd_left ? "red-ink" : "")}>{c.days_to_clear == null ? "–" : plural(c.days_to_clear, "day")}</td>
              <td onClick={(e) => e.stopPropagation()}>{c.drishti ? <><span className={"badge " + drBandUi(c.drishti.band)[1]}>{c.drishti.score}%</span> <button type="button" className="btn link tiny" style={{ padding: 0, fontWeight: 700 }} onClick={() => go("sla", { tab: "scorecard", client_id: c.client_id })}>scorecard ›</button></> : <span className="tiny muted">–</span>}</td>
              <td className="small" style={{ maxWidth: 300 }}>{c.do_first.length ? c.do_first.map((x, k) => <div key={k}>{x}</div>) : <span className="teal-ink">Nothing urgent</span>}</td></tr>)}</tbody></table></div></div>}
        {clientId && <button type="button" className="btn link sm" style={{ alignSelf: "flex-start" }} onClick={() => setClientId("")}>‹ Back to every client</button>}
      </>}
      <ClientReportsTab {...props} fixed={{ clientId, setClientId, leadId }} />
    </div>
  );
}
function ClientReportsTab({ ctx, me, go, openScorecard, fixed }) {
  const [clientId0, setClientId0] = useState(""), [leadId0, setLeadId] = useState("");
  const clientId = fixed ? fixed.clientId : clientId0, setClientId = fixed ? fixed.setClientId : setClientId0, leadId = fixed ? fixed.leadId : leadId0;
  const [dr, setDr] = useState(() => newRange("month"));
  const [from, to] = rangeSpan(dr);
  const ms = { from_ms: dayBounds(from)[0], to_ms: dayBounds(to)[1] };
  const leadsQ = useRpc("team.leads", {}, []);
  const canLead = !!(leadsQ.data && leadsQ.data.can_pick_lead && leadsQ.data.leads.length);
  const leadName = leadId && leadsQ.data ? ((leadsQ.data.leads.find((l) => l.id === leadId) || {}).name || "") : "";
  const q = useRpc("portfolio.overview", { client_id: clientId || undefined, lead_id: leadId || undefined, ...ms }, [clientId, leadId, from, to]);
  const mgr = isPortfolioUser(me);
  const mq = useRpc("portfolio.managers", ms, [from, to], mgr);
  const d = q.data, t = d && d.totals;
  const chg = (cur, prev, goodDown) => { if (prev == null || !prev) return null; const c = Math.round((cur - prev) / Math.abs(prev) * 100); if (!c) return null; const good = goodDown ? c < 0 : c > 0; return <span className={"c3-d " + (good ? "up" : "dn")}>{c > 0 ? "▲" : "▼"}{Math.abs(c)}%</span>; };
  const ago = (ms) => { if (!ms) return "never"; const dd = Math.floor((Date.now() - ms) / 86400000); return dd <= 0 ? "today" : dd === 1 ? "yesterday" : dd + " days ago"; };
  return (
    <div className="stack" style={{ gap: 16 }}>
      {!fixed && <div className="row dash-filters" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 10 }}>
        <div style={{ minWidth: 220 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} allowAll /></div>
        {canLead && <div style={{ minWidth: 210 }}><Field label="Team lead"><Combo value={leadId} onChange={setLeadId} placeholder="All team leads"
          options={leadsQ.data.leads.map((l) => ({ id: l.id, label: l.name + " · " + plural(l.n, "biller") }))} /></Field></div>}
        <DateRange value={dr} onChange={setDr} />
        {(me.is_admin || me.access_all) && <button className="btn" style={{ marginLeft: "auto" }} onClick={() => go("audit")}>Audit trail</button>}</div>}
      {!d ? <Spinner label="Loading…" /> : <>
        {!fixed && <><div className="grid dash-k6">
          <Kpi tone="accent" label="Workable AR" value={fmtMoney(t.ar)} sub={<>{plural(t.clients, "client")} · {t.at_risk ? <span className="red-ink b">{t.at_risk} at risk</span> : "none at risk"}{t.ar_month_ago ? <> · {chg(t.ar_comparable != null ? t.ar_comparable : t.ar, t.ar_month_ago, true) || "no change"} vs a month ago</> : null}</>} />
          <Kpi label="Unassigned" value={fmtInt(t.open_n)} sub={fmtMoney(t.open_bal) + " waiting for allocation"} />
          <Kpi label="Over 90 days" value={<span className={t.over90_pct > d.target ? "red-ink" : "teal-ink"}>{t.over90_pct}%</span>} sub={"target ≤ " + d.target + "%"} />
          <Kpi label={"Collected · " + rangeText(dr).toLowerCase()} value={<span className="teal-ink">{fmtMoney(t.collected_month)}</span>} sub="from payment posting" />
          <Kpi label="KPIs in the red" value={d.drishti && d.drishti.state === "ok" ? <span className={d.drishti.red ? "red-ink" : "teal-ink"}>{fmtInt(d.drishti.red)}</span> : "–"} sub={d.drishti && d.drishti.state === "ok" ? (d.drishti.red ? d.drishti.red_names.join(", ") + " · " + plural(d.drishti.clients_red, "client") : "nothing red on the scorecards") : "Drishti's scorecard is not connected"} />
          <Kpi label="SLA score, average" value={d.drishti && d.drishti.avg != null ? <span className={DR_BAND[d.drishti.avg >= 90 ? "ok" : d.drishti.avg >= 80 ? "warn" : "miss"][0]}>{d.drishti.avg}%</span> : t.sla_avg != null ? <span className={t.sla_avg < 90 ? "amber-ink" : "teal-ink"}>{t.sla_avg}%</span> : "–"}
            sub={d.drishti && d.drishti.avg != null ? `${d.drishti.bands.ok} green · ${d.drishti.bands.warn} amber · ${d.drishti.bands.miss} red (Drishti)` : fmtInt(t.missed) + " missed tasks · " + fmtMoney(t.waiting_bal) + " waiting on clients"} />
        </div>
        <div className="card tight"><div className="table-wrap"><table className="t">
          <thead><tr><th>Client · health</th><th>Team lead · manager</th><th className="num">AR</th><th className="num">Unassigned</th><th className="num">Over 90</th><th className="num">Collected</th><th>SLA score <span className="tiny muted" style={{ fontWeight: 400 }}>· Drishti</span></th><th>Pulling it down</th><th className="num">Missed</th><th>Waiting<br />on client</th><th className="num">TFL risk</th><th title="Claims still to work, at the pace of the last two weeks">Days to<br />clear</th><th>Last<br />inventory</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.client_id} className="click" onClick={() => go("client", { client_id: r.client_id })}>
              <td style={{ minWidth: 230, maxWidth: 320 }}><div className="row" style={{ gap: 8, flexWrap: "nowrap" }}><b style={{ whiteSpace: "nowrap" }}>{r.client}</b><span className={"badge " + HEALTH_UI[r.health][0]}>{HEALTH_UI[r.health][1]}</span></div>
                {r.reasons.length ? <div className="tiny muted" style={{ marginTop: 3 }} title={r.reasons.join("\n")}>{r.reasons[0]}{r.reasons.length > 1 ? " · +" + (r.reasons.length - 1) + " more" : ""}</div> : null}</td>
              <td className="small">{r.tl.join(", ") || "–"}<div className="tiny muted">{r.manager.join(", ")}</div></td>
              <td className="num mono">{fmtMoney(r.ar)} {chg(r.ar, r.ar_month_ago, true)}</td>
              <td className="num">{fmtInt(r.open_n)}<div className="tiny muted">{fmtMoney(r.open_bal)}</div></td>
              <td className={"num " + (r.over90_pct > d.target ? "red-ink" : "")}>{r.over90_pct}%</td>
              <td className="num mono">{fmtMoney(r.collected_month)}</td>
              <td onClick={(e) => e.stopPropagation()} style={{ minWidth: 150 }}>{r.drishti ? <>
                  <div className={"psla-score " + drBandUi(r.drishti.band)[0]}>{r.drishti.score}%</div>
                  <span className={"badge " + drBandUi(r.drishti.band)[1]}>{drBandUi(r.drishti.band)[2]}{r.drishti.delta != null && r.drishti.delta !== 0 ? ` · ${r.drishti.delta > 0 ? "+" : ""}${r.drishti.delta} pts` : ""}</span>
                  <div className="psla-dots">{r.drishti.scopes.map((x) => <span key={x.key}>{drDot(x.band)}{x.short}</span>)}</div>
                  <button type="button" className="btn link tiny" style={{ padding: 0, fontWeight: 700 }} onClick={() => openScorecard ? openScorecard(r.client_id) : go("sla", { tab: "scorecard", client_id: r.client_id })}>scorecard ›</button></>
                : r.sla ? <><span className={r.sla.score < 90 ? "amber-ink b" : "b"}>{r.sla.score}%</span><div className="tiny muted">typed at month-end</div></> : <span className="tiny muted">–</span>}</td>
              <td style={{ minWidth: 150 }}>{r.drishti && r.drishti.drags.length ? r.drishti.drags.slice(0, 3).map((x) => <div key={x.name}><span className={"psla-drag " + x.status}>● {x.name} {x.shown}</span></div>) : r.drishti ? <span className="tiny teal-ink">all green</span> : <span className="tiny muted">–</span>}</td>
              <td className="num">{r.missed || "–"}</td>
              <td className="small">{r.waiting ? <>{fmtMoney(r.waiting.bal)} · {r.waiting.n}<div className="tiny muted">oldest {r.waiting.oldest} d</div></> : "–"}</td>
              <td className="num">{r.tfl_soon_n || r.tfl_past_n ? <span className="red-ink">{fmtMoney(r.tfl_soon)}</span> : "–"}{r.tfl_past_n ? <div className="tiny red-ink">{r.tfl_past_n} past</div> : null}</td>
              <td className="small">{r.days_to_clear != null ? <><b className={r.days_to_clear > 20 ? "red-ink" : r.days_to_clear > 10 ? "amber-ink" : ""}>{r.days_to_clear} days</b><div className="tiny muted">{fmtInt(r.to_work)} claims · {r.per_day}/day · {r.people} people</div></> : <span className="tiny muted">{r.to_work ? fmtInt(r.to_work) + " claims, no work in 2 weeks" : "nothing to work"}</span>}</td>
              <td className="small">{ago(r.last_inventory)}</td>
            </tr>))}</tbody></table></div></div></>}
        <ClaimsSection compact ctx={ctx} go={go} clientId={clientId} setClientId={setClientId} locId="" setLocId={() => {}} leadId={leadId} leadName={leadName} rangeMs={ms} rangeLabel={rangeText(dr)} />
        <div className="c3-g2">
          {mgr && <div className="card"><div className="row between"><h3 className="c3-h">Managers side by side · {rangeText(dr).toLowerCase()}</h3></div>
            {!mq.data ? <Spinner label="Loading…" /> : !mq.data.rows.length ? <Empty>No managers on the roster yet.</Empty> : <div className="table-wrap"><table className="t">
              <thead><tr><th>Manager</th><th className="num">Clients</th><th className="num">People</th><th className="num">Entries</th><th className="num">Skips</th><th className="num">Missed</th><th className="num">Escalations &gt; 24 h</th><th className="num">SLA avg</th></tr></thead>
              <tbody>{mq.data.rows.map((m) => <tr key={m.id}><td className="b">{m.name}</td><td className="num" title={m.clients.join(", ")}>{m.clients.length}</td><td className="num">{m.people}</td><td className="num">{fmtInt(m.entries)}</td><td className="num">{m.skips}</td><td className="num">{m.missed}</td><td className={"num " + (m.escalations_late ? "red-ink b" : "")}>{m.escalations_late}</td><td className="num">{m.sla_avg != null ? m.sla_avg + "%" : "–"}</td></tr>)}</tbody></table></div>}
            <div className="tiny muted mt8">Entries and skips by everyone under each manager in the roster; missed tasks, escalations and SLA for the clients in their span.</div></div>}
          <div className="card"><h3 className="c3-h">Data freshness</h3>
            {d.freshness.length ? d.freshness.slice(0, 12).map((f, i) => <div key={i} className="c3-line"><span><span className={"badge " + (f.tone === "red" ? "red" : "amber")} style={{ marginRight: 8 }}>{f.tone === "red" ? "stale" : "check"}</span>{f.text}</span>{f.client_id && <button className="btn link sm" onClick={() => go("client", { client_id: f.client_id })}>open</button>}</div>)
              : <Empty>{d.rows.length ? "Everything is fresh: inventories uploaded in the last week, SLA scored, roster in sync." : "No clients yet, so there is nothing to check."}</Empty>}
            <div className="tiny muted mt8">Numbers are only as good as the data behind them: inventory older than a week, an SLA not scored after its due day or a roster sync that failed are flagged here.</div></div>
        </div>
      </>}
    </div>
  );
}
const AUDIT_LABEL = { "access.share": "Shared a client", "access.remove": "Took a share back", "raci.save": "Changed the RACI", "feedback.recipients": "Changed who gets feedback",
  "client.responsibility": "Changed posting / submission responsibility", "settings.save": "Changed settings", "client.delete": "Deleted a client", "client.save": "Edited a client",
  "user.save": "Changed a team member", "client.log": "Logged a client call", "monthend.sla": "Scored the SLA", "monthend.pack": "Month-end: pack built", "monthend.sent": "Month-end: pack sent", "creport.edit": "Edited the client report", "creport.ev": "EV file for the client report", "client.logo": "Changed the client's logo",
  "monthend.internal": "Month-end: internal reports reviewed", "monthend.inventory": "Month-end: inventory", "monthend.sla_inventory": "Month-end: AR Inventory to the scorecard", "digest.sendNow": "Sent the Monday digest by hand", "payers.limit": "Changed an insurance TFL / AFL" };
function AuditView({ ctx }) {
  const [f, setF] = useState({ client_id: "", action: "" });
  const q = useRpc("audit.list", { client_id: f.client_id || undefined, action: f.action || undefined }, [f.client_id, f.action]);
  const rows = (q.data && q.data.rows) || [];
  return (
    <div className="stack">
      <div><h1>Audit trail</h1><div className="sub">Who changed access, the RACI, who gets feedback, client settings, responsibilities, team members and month-end, newest first (last 500).</div></div>
      <div className="card tight row" style={{ gap: 10, flexWrap: "wrap" }}>
        <span style={{ minWidth: 240 }}><Combo sm value={f.client_id} onChange={(v) => setF({ ...f, client_id: v })} placeholder="Every client" options={ctx.clients.map((c) => ({ id: c.id, label: c.name }))} /></span>
        <select className="input sm" style={{ width: "auto" }} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
          <option value="">Every change</option><option value="access">Sharing</option><option value="raci">RACI</option><option value="user">Team members</option><option value="client">Clients</option><option value="creport">Client report</option><option value="monthend">Month-end</option><option value="feedback">Feedback</option><option value="settings">Settings</option></select>
        <span className="small muted" style={{ marginLeft: "auto" }}>{rows.length} changes</span></div>
      {q.error ? <div className="alert err">{q.error}</div> : !q.data ? <Spinner label="Loading…" /> : !rows.length ? <div className="card"><Empty>No changes recorded yet. They are recorded from now on.</Empty></div> :
        <div className="card tight"><div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Client</th><th>Detail</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td className="small" style={{ whiteSpace: "nowrap" }}>{fmtWhen(r.at)}</td><td className="small">{r.user_name || "–"}</td><td className="small b">{AUDIT_LABEL[r.action] || r.action}</td><td className="small">{r.client_name || "–"}</td><td className="small">{r.detail}</td></tr>)}</tbody></table></div></div>}
    </div>
  );
}
/* ---------- Client 360: everything about one client on one page (client managers, team leads, the VP) ---------- */
const C360_KIND = [["call", "Call"], ["email", "Email"], ["meeting", "Meeting"], ["note", "Note"], ["next", "Next call"]];
const c360Last = () => { try { return localStorage.getItem("brahmastra:c360") || ""; } catch (e) { return ""; } };
function TrendChart({ trend }) {
  if (!trend || trend.length < 2) return null;
  const W = 620, H = 190, L = 44, B = 160, top = 34, max = Math.max(...trend.map((t) => t.ar), 1), pmax = Math.max(30, ...trend.map((t) => t.pct));
  const bw = Math.min(58, (W - L - 20) / trend.length - 14), x = (i) => L + 12 + i * ((W - L - 20) / trend.length);
  const y = (v) => B - (v / max) * (B - top), yp = (p) => B - (p / pmax) * (B - top);
  const mName = (m) => new Date(m + "-15T12:00:00").toLocaleDateString(undefined, { month: "short" });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} role="img" aria-label="AR and over-90 trend">
      <line x1={L} y1={B} x2={W - 8} y2={B} stroke="var(--line)" />
      <text x="0" y={B + 4} fontSize="11" fill="var(--slate)">$0</text><text x="0" y={top + 4} fontSize="11" fill="var(--slate)">{fmtMoney(max).replace(/,\d{3}$/, "k")}</text>
      {trend.map((t, i) => <rect key={t.month} x={x(i)} y={y(t.ar)} width={bw} height={B - y(t.ar)} rx="5" fill={i === trend.length - 1 ? "var(--teal)" : "var(--soft)"} stroke={i === trend.length - 1 ? "none" : "var(--line)"}><title>{mName(t.month) + ": " + fmtMoney(t.ar) + ", " + t.pct + "% over 90 days"}</title></rect>)}
      <polyline fill="none" stroke="#C94F4F" strokeWidth="2.5" points={trend.map((t, i) => `${x(i) + bw / 2},${yp(t.pct)}`).join(" ")} />
      {trend.map((t, i) => <g key={"p" + t.month}><circle cx={x(i) + bw / 2} cy={yp(t.pct)} r={i === trend.length - 1 ? 4.5 : 3.5} fill="#C94F4F" />
        {(i === 0 || i === trend.length - 1) && <text x={x(i) + bw / 2} y={yp(t.pct) - 9} fontSize="11" fontWeight="700" textAnchor="middle" fill="#C94F4F">{t.pct}%</text>}
        <text x={x(i) + bw / 2} y={B + 18} fontSize="11" textAnchor="middle" fill="var(--body)" fontWeight={i === trend.length - 1 ? 700 : 400}>{mName(t.month)}</text></g>)}
    </svg>
  );
}
/* The Monday digest: one email per manager's span, on the SLA tab: every span the person can see, who gets it, when it
   last went, with a preview and a copy to yourself (clientId narrows it to the span one client is in). */
function DigestSpans({ clientId, me }) {
  const q = useRpc("digest.spans", clientId ? { client_id: clientId } : {}, [clientId]);
  const [prev, setPrev] = useState(null);
  const [busy, setBusy] = useState(null);
  const d = q.data;
  const act = async (k, fn) => { setBusy(k); try { await fn(); } catch (e) { toast(e.message, "err"); } setBusy(null); };
  const preview = (s) => act("p" + s.key, async () => setPrev(await rpc("digest.preview", { span: s.key })));
  const sendMe = (s) => act("m" + s.key, async () => { const r = await rpc("digest.sendMe", { span: s.key }); toast("A copy is on its way to " + r.to + "."); });
  const sendNow = (s) => act("n" + s.key, async () => { const r = await rpc("digest.sendNow", { span: s.key }); toast(r.sent || r.failed ? `Sent to ${r.sent}${r.failed ? ", " + r.failed + " failed" : ""}.` : "Everyone on this span already had this week's digest."); q.reload(); });
  if (!d) return <div className="card no-print">{q.error ? <div className="alert err">{q.error}</div> : <Spinner label="Loading the Monday digest…" />}</div>;
  return (
    <div className="card no-print"><div className="row between"><h3 className="c3-h">Monday digest email</h3><span className="tiny muted">every Monday, about 8:30 AM IST</span></div>
      <div className="small">One email per manager's span: their clients' health, AR, over 90, collected, entries, what needs attention, client by client, and the team, for last week. It goes to the manager and every supervisor on those clients. No patient details.</div>
      {!d.email_ready && <div className="tiny amber-ink mt8">Email is not set up on the server, so nothing goes out yet.</div>}
      {d.mine_off && <div className="tiny muted mt8">You turned yours off in Settings › Email.</div>}
      {!d.spans.length && <Empty>{clientId ? "This client is in no digest yet." : "No spans yet: they come from the managers on the roster."}</Empty>}
      {d.spans.map((s) => { const on = s.recipients.filter((r) => !r.off); const last = s.runs[0]; return (
        <div key={s.key} className="digest-span mt8">
          <div className="row between" style={{ gap: 8 }}><div><b>{s.title}</b><div className="tiny muted">{s.clients.map((c) => c.name).join(", ")}</div></div>
            <span className="tiny muted">{on.length} {on.length === 1 ? "person" : "people"}{s.recipients.length > on.length ? ` · ${s.recipients.length - on.length} turned off` : ""}</span></div>
          <div className="pill-list mt8">{s.recipients.map((r) => <span key={r.id} className={"badge " + (r.off ? "gray" : "teal")} title={r.off ? "Turned off in their Settings" : r.designation} style={r.off ? { textDecoration: "line-through" } : null}>{r.name}{r.me ? " (you)" : ""}</span>)}</div>
          <div className="tiny muted mt8">{last ? `Last sent ${fmtWhen(last.at)} (week of ${fmtDate(last.week)}): ${last.sent} sent${last.failed ? ", " + last.failed + " failed" : ""}${last.by_name && last.by_name !== "Monday job" ? ", by " + last.by_name : ""}.` : "Not sent yet."}
            {s.fails.length > 0 && <span className="red-ink"> Not delivered to {s.fails.map((f) => f.name).join(", ")}: {s.fails[0].error}</span>}</div>
          {s.visible && <div className="row mt8" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn sm primary" onClick={() => { location.hash = "#/digest?span=" + encodeURIComponent(s.key); }}>Open the dashboard</button> <button className="btn sm" disabled={!!busy} onClick={() => preview(s)}>{busy === "p" + s.key ? "Building…" : "Preview the email"}</button>
            {d.email_ready && <button className="btn sm" disabled={!!busy} onClick={() => sendMe(s)}>{busy === "m" + s.key ? "Sending…" : "Email me a copy"}</button>}
            {d.can_send && d.email_ready && <button className="btn sm" disabled={!!busy} onClick={() => sendNow(s)} title="Sends this week's digest now to anyone on this span who has not had it">{busy === "n" + s.key ? "Sending…" : "Send this week's now"}</button>}
          </div>}
        </div>); })}
      {prev && <Modal title="Monday digest preview" sub={prev.subject} wide onClose={() => setPrev(null)}>
        <iframe title="Digest preview" className="digest-frame" sandbox="" srcDoc={'<!doctype html><meta charset="utf-8"><body style="margin:16px;background:#fff">' + prev.html + "</body>"} /></Modal>}
    </div>
  );
}
function ClientView({ ctx, me, go, params }) {
  const active = ctx.clients.filter((c) => c.active);
  const [cid, setCid] = useState(() => { const want = (params && params.client_id) || c360Last(); return active.some((c) => c.id === want) ? want : (active[0] || {}).id || ""; });
  const [missing, setMissing] = useState(() => !!(params && params.client_id) && !active.some((c) => c.id === params.client_id));
  useEffect(() => { try { if (cid) localStorage.setItem("brahmastra:c360", cid); } catch (e) {} }, [cid]);
  const [dr, setDr] = useState(() => newRange("month"));
  const [month, setMonth] = useState("");
  // The client report is Dashboard › Client 360 report now; an old Client 360 › Client report link goes there.
  useEffect(() => { if (params && params.tab === "report" && cid) go("dashboard", { tab: "report", client_id: cid }); }, [params && params.tab]);
  const [from, to] = rangeSpan(dr);
  const q = useRpc("client.overview", { client_id: cid, from_ms: dayBounds(from)[0], to_ms: dayBounds(to)[1], month: month || undefined }, [cid, from, to, month], !!cid);
  const d = q.data;
  const [log, setLog] = useState({ kind: "call", text: "", next_on: "" });
  const [busy, setBusy] = useState(false);
  const [scoreFor, setScoreFor] = useState(null);
  const addLog = async () => { setBusy(true); try { await rpc("client.logAdd", { client_id: cid, ...log }); setLog({ kind: "call", text: "", next_on: "" }); toast("Added to the call log."); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const delLog = async (l) => { setBusy(true); try { await rpc("client.logDelete", { id: l.id }); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  const tick = async (stp, done, score) => { setBusy(true); try { await rpc("monthend.set", { client_id: cid, month: d.monthend.month, step: stp.key, done, score }); setScoreFor(null); q.reload(); } catch (e) { toast(e.message, "err"); } setBusy(false); };
  if (!active.length) return <div className="card"><Empty>No clients in your span yet.</Empty></div>;
  const delta = (cur, prev, goodDown) => { if (prev == null || !prev) return null; const ch = Math.round((cur - prev) / Math.abs(prev) * 100); if (!ch) return <span className="small muted">no change</span>; const good = goodDown ? ch < 0 : ch > 0; return <span className={"c3-d " + (good ? "up" : "dn")}>{ch > 0 ? "▲" : "▼"} {Math.abs(ch)}%</span>; };
  const hp = d ? { good: ["green", "On track"], watch: ["amber", "Needs attention"], risk: ["red", "At risk"] }[d.health] : null;
  const monthLabel = (m) => new Date(m + "-15T12:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const thisMonth = todayISO().slice(0, 7), prevMonth = (() => { const [y, m] = thisMonth.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();
  return (
    <div className="stack c360" style={{ gap: 16 }}>
      <div className="row between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="row no-print" style={{ gap: 8, marginBottom: 6 }}><span style={{ minWidth: 260 }}><Combo value={cid} onChange={(v) => { if (v) { setCid(v); setMissing(false); } }} clearable={false} options={active.map((c) => ({ id: c.id, label: c.name + (c.code ? " (" + c.code + ")" : "") }))} /></span></div>
          <h1 style={{ margin: 0 }}>{d ? d.client.name : "Client 360"} {d && d.client.code && <span className="badge ink" style={{ fontSize: 12, verticalAlign: "middle" }}>{d.client.code}</span>}</h1>
          {d && <div className="sub">{[d.raci && d.raci.a.length ? "Team lead " + d.raci.a.map((p) => p.name).join(", ") : "", d.raci && d.raci.c.length ? "Manager " + d.raci.c.map((p) => p.name).join(", ") : "", d.client.team ? d.client.team + " billers" : "", d.client.locations.join(", ")].filter(Boolean).join(" · ")}</div>}
        </div>
        <div className="row no-print" style={{ gap: 8, flexWrap: "wrap" }}><DateRange value={dr} onChange={setDr} label="" /><button className="btn" onClick={() => window.print()} title="Print this page, or save it as a PDF for the client call">⬇ Client call pack (PDF)</button>
          <button className="btn c3-report" onClick={() => go("dashboard", { tab: "report", client_id: cid })} title="The client's report pack, on the Dashboard: its pages, charts and the PDF">Client 360 report ›</button></div>
      </div>
      {missing && <div className="alert">The client in the link is not one of your active clients. Showing {(active.find((c) => c.id === cid) || {}).name || "another client"} instead.</div>}
      {!d ? <Spinner label="Loading…" /> : <>
        <div className={"c3-health " + hp[0]}><span className={"badge " + hp[0]}>● {hp[1]}</span>
          {d.reasons.length ? <ul>{d.reasons.map((r, i) => <li key={i} className={r.tone}>{r.text}</li>)}</ul> : <span className="small muted">Nothing needs attention: aging, timely filing, escalations and client requests are all within range.</span>}</div>
        <div className="c3-kpis">
          <Kpi tone="accent" label="AR balance" value={fmtMoney(d.ar.balance)} sub={<>{delta(d.ar.balance, d.ar.month_ago, true) || plural(d.ar.claims, "claim")}{d.ar.month_ago != null ? " vs a month ago" : ""}</>} />
          <Kpi label="Over 90 days" value={<span className={d.ar.over90_pct > d.ar.target ? "red-ink" : "teal-ink"}>{d.ar.over90_pct}%</span>} sub={"target ≤ " + d.ar.target + "% · " + fmtMoney(d.ar.over90)} />
          <Kpi label="SLA score" value={d.sla ? <span className={d.sla.score < 90 ? "amber-ink" : "teal-ink"}>{d.sla.score}%</span> : "–"} sub={d.sla ? <>{monthLabel(d.sla.month)}{d.sla.prev != null ? <> · <span className={"c3-d " + (d.sla.score >= d.sla.prev ? "up" : "dn")}>{d.sla.score >= d.sla.prev ? "▲" : "▼"} {Math.abs(Math.round((d.sla.score - d.sla.prev) * 10) / 10)}</span></> : null}</> : "tick SLA scored below"} />
          <Kpi label={"Collected · " + rangeText(dr)} value={<span className="teal-ink">{fmtMoney(d.collected.amount)}</span>} sub={<>{delta(d.collected.amount, d.collected.prev) || fmtInt(d.collected.n) + " postings"}{d.collected.prev ? " vs the period before" : ""}</>} />
          <Kpi label="Waiting on client" value={<span className={d.waiting.rows.length ? "amber-ink" : ""}>{fmtMoney(d.waiting.balance)}</span>} sub={d.waiting.rows.length ? d.waiting.rows.length + " requests · oldest " + d.waiting.oldest + " days" : "nothing waiting"} />
          <Kpi label="Timely filing risk" value={<span className={d.tfl.soon_n || d.tfl.past_n ? "red-ink" : ""}>{fmtMoney(d.tfl.soon_bal)}</span>} sub={d.tfl.soon_n + " claims in 30 days" + (d.tfl.past_n ? " · " + d.tfl.past_n + " past (" + fmtMoney(d.tfl.past_bal) + ")" : "")} />
        </div>
        <div className="c3-g2">
          <div className="card"><div className="row between"><h3 className="c3-h">AR and over-90 · by month</h3><span className="tiny muted">bars: AR balance · line: % over 90 days</span></div>
            {d.trend.length >= 2 ? <><TrendChart trend={d.trend} /><div className="tiny muted">{(() => { const a = d.trend[0], b = d.trend[d.trend.length - 1]; return (b.ar < a.ar ? "AR is falling" : b.ar > a.ar ? "AR is rising" : "AR is flat") + (b.pct > a.pct ? ", and what is left is getting older: the over-90 share went from " + a.pct + "% to " + b.pct + "%." : ", and the over-90 share went from " + a.pct + "% to " + b.pct + "%."); })()}</div></>
              : <Empty>The trend fills in by itself: Brahmastra keeps one reading a day{d.first_snapshot ? " (first on " + fmtDate(d.first_snapshot) + ")" : ""}, and shows one point a month from the second month on.</Empty>}</div>
          <div className="card"><div className="row between"><h3 className="c3-h">Denial and rejection reasons · {rangeText(dr)}</h3><span className="tiny muted">from billers' entries</span></div>
            {d.reasons_top.length ? <Bars rows={d.reasons_top} labelOf={(r) => r.reason} valueOf={(r) => r.bal} countOf={(r) => r.n} subOf={(r) => fmtInt(r.n) + " claims"} /> : <Empty>No denied or rejected entries in these dates.</Empty>}</div>
        </div>
        <div className="c3-g2">
          <div className="card"><div className="row between"><h3 className="c3-h">Waiting on the client</h3><span className="tiny muted">chased by itself after 3 working days</span></div>
            {d.waiting.rows.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Claim</th><th>What is needed</th><th>Asked by</th><th>Sent</th><th>Waiting</th><th>Balance</th></tr></thead><tbody>
              {d.waiting.rows.slice(0, 8).map((w) => <tr key={w.id}><td className="mono small">{w.claim_no || "–"}</td><td className="small">{w.reason || w.note || "–"}</td><td className="small">{w.dept_label}</td>
                <td className="small">{w.sent ? (w.client_sent_by_name || "") + (w.client_sent_how ? " · " + w.client_sent_how : "") : <span className="badge gray">not sent yet</span>}</td>
                <td><span className={"badge " + (w.days >= 5 ? "red" : w.days >= 3 ? "amber" : "gray")}>{w.days} day{w.days === 1 ? "" : "s"}{w.chase_at && w.chase_at < Date.now() ? " · chased" : ""}</span></td><td className="mono small">{fmtMoney(w.balance)}</td></tr>)}</tbody></table></div>
              : <Empty>Nothing is waiting on the client.</Empty>}
            <div className="tiny muted mt8">{d.waiting.reply ? "Average client reply, last 90 days: " + d.waiting.reply.days + " days (" + d.waiting.reply.n + " answered)" : "Reply times show once the client answers a few requests."}{d.waiting.reply_all ? " · all clients: " + d.waiting.reply_all.days + " days" : ""}</div></div>
          <div className="card"><h3 className="c3-h">Team and follow-through · {rangeText(dr)}</h3>
            <div className="c3-line"><span>Escalations open</span><span><b>{d.escalations.open}</b> {d.escalations.late ? <span className="badge red">{d.escalations.late} over 24 h</span> : null}</span></div>
            <div className="c3-line"><span>Missed tasks · AR</span><span><b>{d.missed.ar}</b> <span className="tiny muted">allocated, not worked</span></span></div>
            <div className="c3-line"><span>Missed tasks · posting / submission</span><span><b>{d.missed.posting + d.missed.submission}</b> <span className="tiny muted">past 24 h TAT</span></span></div>
            <div className="c3-line"><span>Entries made</span><span><b>{fmtInt(d.worked.entries)}</b> <span className="tiny muted">by {d.worked.people} people</span></span></div>
            <div className="c3-line"><span>Over 120 days</span><span><b>{fmtMoney(d.ar.over120)}</b></span></div>
            {d.raci && <div className="tiny muted mt8">RACI: R {d.raci.r.slice(0, 2).map((p) => p.name).join(", ")}{d.raci.r.length > 2 ? " +" + (d.raci.r.length - 2) : ""} · A {d.raci.a.map((p) => p.name).join(", ") || "–"} · C {d.raci.c.map((p) => p.name).join(", ") || "–"} · I {d.raci.i.map((p) => p.name).join(", ")} <button className="btn link sm no-print" onClick={() => go("raci")}>edit</button></div>}</div>
        </div>
        <div className="c3-g2">
          <div className="card"><div className="row between"><h3 className="c3-h">Month-end · {monthLabel(d.monthend.month)}</h3>
              <span className="row" style={{ gap: 6 }}><span className={"badge " + (d.monthend.done === d.monthend.steps.length ? "green" : "amber")}>{d.monthend.done} of {d.monthend.steps.length} done</span>
                <select className="input sm no-print" style={{ width: "auto" }} value={d.monthend.month} onChange={(e) => setMonth(e.target.value)}>{[...new Set([d.monthend.month, thisMonth, prevMonth])].map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></span></div>
            {d.monthend.steps.map((stp) => { const late = !stp.done && stp.due < todayISO(); return (
              <div key={stp.key} className="c3-step">
                <button type="button" className={"c3-tick " + (stp.done ? "ok" : late ? "late" : "")} disabled={!d.monthend.can_edit || busy} title={d.monthend.can_edit ? (stp.done ? "Mark not done" : "Mark done") : "View only"}
                  onClick={() => (stp.done ? tick(stp, false) : stp.key === "sla" ? setScoreFor("") : tick(stp, true))}>{stp.done ? "✓" : late ? "!" : ""}</button>
                <div style={{ flex: 1 }}><div className={stp.done ? "" : "b"}>{stp.label}{stp.key === "sla" && stp.score != null ? <span className="badge teal" style={{ marginLeft: 6 }}>{stp.score}%</span> : null}
                  {stp.key === "pack" && <button type="button" className="btn sm link no-print" style={{ padding: "0 0 0 8px" }} onClick={() => go("dashboard", { tab: "report", client_id: cid })}>Open Client 360 report</button>}</div>
                  <div className="tiny muted">{stp.done ? (stp.by_itself ? "done by itself" : "done") + " · " + fmtWhen(stp.done_at) + (stp.done_by_name && !stp.by_itself ? " · " + stp.done_by_name : "") : (late ? "was due " : "due ") + fmtDate(stp.due)}{!stp.done && stp.auto ? " · ticks by itself" : ""}</div>
                  {stp.key === "sla" && scoreFor !== null && !stp.done && <div className="row mt8" style={{ gap: 6 }}><input className="input sm" type="number" min="0" max="100" step="0.1" style={{ width: 110 }} placeholder="Score %" value={scoreFor} onChange={(e) => setScoreFor(e.target.value)} autoFocus />
                    <button className="btn sm primary" disabled={busy || scoreFor === ""} onClick={() => tick(stp, true, scoreFor)}>Save score</button><button className="btn sm link" onClick={() => setScoreFor(null)}>cancel</button><span className="tiny muted">from the SLA tab</span></div>}
                </div></div>); })}</div>
          <div className="card"><div className="row between"><h3 className="c3-h">Client call log</h3></div>
            {d.monthend.can_edit && <div className="no-print" style={{ marginBottom: 10 }}>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><div className="seg2">{C360_KIND.map(([k, l]) => <button key={k} className={log.kind === k ? "on" : ""} onClick={() => setLog({ ...log, kind: k })}>{l}</button>)}</div>
                {log.kind === "next" && <input className="input sm" type="date" value={log.next_on} min={todayISO()} onChange={(e) => setLog({ ...log, next_on: e.target.value })} />}</div>
              <div className="row mt8" style={{ gap: 6 }}><textarea className="textarea" style={{ minHeight: 54, flex: 1 }} value={log.text} onChange={(e) => setLog({ ...log, text: e.target.value })} placeholder={log.kind === "next" ? "What to prepare for the next call" : "What was said or decided, and by whom"} />
                <button className="btn primary" disabled={busy || log.text.trim().length < 8 || (log.kind === "next" && !log.next_on)} onClick={addLog}>Add</button></div></div>}
            {d.log.length ? d.log.slice(0, 12).map((l) => <div key={l.id} className={"c3-log " + l.kind}><b>{l.kind === "next" ? "Next call · " + fmtDate(l.next_on) : C360_KIND.find(([k]) => k === l.kind)[1] + " · " + fmtWhen(l.at)} · {l.by_name}{(l.mine || (me.role === "supervisor" && d.monthend.can_edit)) && <button className="btn link sm no-print" style={{ padding: "0 4px" }} disabled={busy} onClick={() => delLog(l)}>remove</button>}</b>{l.text}</div>)
              : <Empty>No calls logged yet. Note what the client agreed and when the next call is, so the next person does not start from zero.</Empty>}</div>
        </div>
        <div className="tiny muted">Figures are Brahmastra's: AR from the latest inventory, collected from payment posting hand-offs, SLA from the score ticked at month-end. Over-90 target {d.ar.target}%.</div>
      </>}
    </div>
  );
}
/* ---------- SAAG reference ---------- */
function SaagView() {
  const [status, setStatus] = useState(SAAG.statuses[0] || "");
  const [sub, setSub] = useState("");
  const [q, setQ] = useState("");
  const subs = saagSubs(status);
  const acts = sub ? saagActions(status, sub) : [];
  const hits = useMemo(() => { const t = q.trim().toLowerCase(); if (t.length < 2) return []; const out = []; SAAG.statuses.forEach((s) => saagSubs(s).forEach((u) => { if (u.toLowerCase().includes(t)) out.push({ s, u }); })); return out.slice(0, 30); }, [q]);
  return (
    <div className="stack">
      <div className="row between"><div><h1>SAAG reference</h1><div className="sub">Status › Sub-status › Action, with the Effective Matrix and the bucket each action lands in. Loaded from <span className="mono">lib/saag.js</span>, generated from the SAAG Claim Entry Tool workbook: {fmtInt(SAAG.statuses.length)} statuses, {fmtInt(SAAG.subStatuses.length)} sub-statuses, {fmtInt(SAAG.actions.length)} actions, {fmtInt(SAAG.rows.length)} combinations.</div></div>
        <input className="input" style={{ width: 280 }} placeholder="find a sub-status…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {hits.length > 0 && <div className="card tight"><div className="pill-list">{hits.map((h, i) => <button key={i} className="chip" onClick={() => { setStatus(h.s); setSub(h.u); setQ(""); }}>{h.s} › {h.u}</button>)}</div></div>}
      <div className="row" style={{ gap: 4 }}>{SAAG.statuses.map((s) => <button key={s} className={"chip " + (status === s ? "on" : "")} onClick={() => { setStatus(s); setSub(""); }}>{s} <span className="muted">{saagSubs(s).length}</span></button>)}</div>
      <div className="grid g2-1">
        <div className="card tight"><div className="b small mb">Sub-statuses of {status}</div><div className="pill-list">{subs.map((u) => <button key={u} className={"chip " + (sub === u ? "on" : "")} onClick={() => setSub(u)}>{u}</button>)}</div></div>
        <div className="card tight"><div className="b small mb">{sub ? `Actions for ${status} › ${sub}` : "Pick a sub-status to see its actions"}</div>
          {sub && <div className="table-wrap"><table className="t"><thead><tr><th>Action</th><th>Effective matrix</th><th>Bucket</th></tr></thead><tbody>{acts.map((a) => <tr key={a.action}><td>{a.action}</td><td className="small">{a.effective || "–"}</td><td><span className={"badge " + (EFFECTIVE_BUCKET[a.effective] === "Closed" ? "green" : "teal")}>{EFFECTIVE_BUCKET[a.effective] || "–"}</span></td></tr>)}</tbody></table></div>}</div>
      </div>
      <div className="card tight small muted">Bucket mapping: Pending-Collectible Insurance → Payer · Pending-Client Assistance and Pending-Collectible Patient → Client · Pending-Purview internal review → Purview · Processing-Closed and Payment-Cash In Bank → Closed. A biller can change the bucket on any entry. When the workbook changes, regenerate <span className="mono">lib/saag.js</span> (see README) and the whole team gets the new matrix on the next refresh.</div>
    </div>
  );
}

/* ---------- reports ---------- */
const REPORT_COLS = [
  { key: "created_at", label: "Date / time", get: (r) => new Date(r.created_at).toLocaleString() }, { key: "user_name", label: "Biller" }, { key: "client_name", label: "Client" }, { key: "location_name", label: "Location" },
  { key: "claim_no", label: "Claim #" }, { key: "account_no", label: "Account #" }, { key: "patient", label: "Patient" }, { key: "payer", label: "Payer" }, { key: "provider", label: "Provider" }, { key: "dos", label: "DOS" }, { key: "cpt", label: "CPT" }, { key: "balance", label: "Balance" }, { key: "age_days", label: "Age" }, { key: "bucket", label: "Aging bucket" }, { key: "tier", label: "Tier" },
  { key: "file_status", label: "File status" }, { key: "file_sub_status", label: "File sub status" }, { key: "kind", label: "Entry" },
  { key: "status", label: "SAAG status", get: (r) => r.status || r.status_code }, { key: "sub_status", label: "SAAG sub-status" }, { key: "action", label: "SAAG action", get: (r) => r.action || r.action_code }, { key: "work_bucket", label: "Bucket" }, { key: "effective", label: "Effective matrix" },
  { key: "f_dos", label: "Note DOS", get: (r) => r.f.dos }, { key: "f_clm", label: "Note CLM#", get: (r) => r.f.clm }, { key: "f_denial", label: "Denial", get: (r) => r.f.denial }, { key: "f_source", label: "Source", get: (r) => r.f.source }, { key: "f_ref", label: "REF", get: (r) => r.f.ref },
  { key: "f_pre", label: "Pre call check", get: (r) => [...(r.f.precheck || []), r.f.precheck_text].filter(Boolean).join("; ") }, { key: "f_findings", label: "RCA / findings", get: (r) => r.f.findings },
  { key: "follow_up_on", label: "Follow-up" }, { key: "comment", label: "Note (one cell)" }, { key: "edited_at", label: "Edited", get: (r) => (r.edited_at ? new Date(r.edited_at).toLocaleString() : "") }, { key: "state", label: "Claim state now" },
];
const reportRow = (r) => { let f = {}; try { f = JSON.parse(r.fields_json || "{}"); } catch (e) {} return { ...r, f: f || {} }; };
/* ---------- My day & reports ----------
   Grouped by who the report is for. Internal: the team's work in Brahmastra, and quality & production (Sasha's Third Eye).
   For clients: the client report (Brahmastra's own, in Client 360) and the SLA scorecard (Drishti). Team leads and
   above only. Third Eye and Drishti run inside Brahmastra from their own web addresses with ?embed=1, which hides their own headers so
   the page reads as one product; their formulas, files and data stay as their owners keep them. Every upload inside them
   comes from the Purviewautomate OneDrive, and what Brahmastra hands them goes in directly or through that OneDrive. */
const TE_BASE = CFG.THIRD_EYE_URL || "https://purview-healthcare.github.io/Sashas-third-eye/";
const DR_BASE = CFG.DRISHTI_URL || "https://purview-healthcare.github.io/Drishti/";
const withQuery = (u, q) => u + (u.includes("?") ? "&" : "?") + q;
const themeNow = () => document.documentElement.getAttribute("data-theme") || "light";
const embedUrl = (base, extra) => withQuery(base, "embed=1&theme=" + themeNow() + (extra ? "&" + extra : ""));
const Ico = ({ d, size = 17 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const HUB_ICONS = {
  work: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
  quality: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
  sla: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  ext: <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />,
  full: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  reload: <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />,
};
const HUB_PAGES = {
  work: { group: "int", title: "Team work", short: "Allocated vs worked",
    desc: "Every allocated claim with the work done on it (SAAG status, action, bucket and comment), for any dates. What is still waiting is flagged." },
  quality: { group: "int", title: "Internal reports", short: "QA, targets, outliers, RCA", app: "Sasha's Third Eye",
    desc: "How well and how much each person works, against target, with the reasons behind the misses.",
    what: "QA scores and errors per biller, team and client; production against the daily target; outliers below the QA line for 2 weeks; the top errors with RCA and mitigation; sampling coverage against each person's band; this period against the last.",
    when: "Weekly and monthly team reviews, QA feedback, deciding who needs coaching, a QIP or a PIP.",
    steps: [
      ["Pick the work and the dates", "AR, Payment Posting or Submission, a client (or all of yours) and the dates."],
      ["Load production", "Brahmastra's entries and the team roster go straight into Third Eye. No conso export."],
      ["Add the QA tracker", "Inside Third Eye, the QA box opens the client's QA tracker folder in the Purviewautomate OneDrive. Pick the file."],
      ["Read and act", "Overview first, then the tabs. Targets, RCA and the Quality insights file save to OneDrive by themselves."],
    ] },
  sla: { group: "cli", title: "SLA scorecard", short: "Met or missed, per client", app: "Drishti",
    desc: "Did we meet what each client signed for? One score per client, and what is pulling it down.",
    what: "A green, amber or red score per client (90% and above is healthy), every KPI and SLA against its target, the reasons for misses, month-by-month history and the leadership overview, worst client first.",
    when: "Week-end and month-end client reporting, leadership reviews, preparing for client calls.",
    steps: [
      ["Nothing to sign in to", "Drishti opens signed in as you, from your Brahmastra sign-in."],
      ["Put the AR Inventory in OneDrive", "Save AR Inventory to OneDrive writes today's inventory into the client's SLA & KPI folder."],
      ["Upload the period's reports", "In Drishti, Upload from OneDrive: pick the period's files, the AR Inventory report included."],
      ["Fill in and read", "Type the values that do not come from reports, add reasons for any red, then read the score."],
    ] },
};
const TE_SCOPES = [["ar", "AR"], ["pp", "Payment Posting"], ["sub", "Submission"]];
function xlsxBook(header, rows, sheet) {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = header.map((h) => ({ wch: Math.min(40, Math.max(10, String(h).length + 2)) }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet);
  return wb;
}
function xlsxBlob(header, rows, sheet) {
  return new Blob([XLSX.write(xlsxBook(header, rows, sheet), { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
const safeName = (s) => String(s || "").replace(/[\\/:*?"<>|]+/g, " ").trim();
/* The team roster in the columns Third Eye's roster reads (the same as the Purview roster CSV). */
function rosterSheet(users) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const header = ["Emp ID", "Name", "Position", "Department", "Project", "Reports to", "Status", "Shift", "DOJ", "Email"];
  const rows = users.filter((u) => u.active && !u.is_admin).map((u) => [u.emp_id || "", u.name, u.designation || u.position || "", u.department || "", (u.projects || []).map((p) => p.name).join("; "),
    u.reports_to_name || (byId.get(u.reports_to) || {}).name || "", u.roster_status || "Production", u.shift || "", u.doj || "", u.email || ""]);
  return { header, rows };
}
/* Third Eye saves its Quality insights to Brahmastra Reports / <team lead> / <client>. It asks the page around it
   (window.BRAHMASTRA_REPORTS) who is signed in and each client's team lead, and opens the QA box in that client's
   QA tracker folder. Folder names are cleaned the same way as odName in worker.js. */
const odName = (s) => String(s || "").replace(/["*:<>?/\\|#%]+/g, " ").replace(/\s+/g, " ").trim().replace(/\.+$/, "").slice(0, 80) || "Unnamed";
function useReportsContext(me, client) {
  const leadsQ = useRpc("reports.clientLeads", {}, []);
  const leads = (leadsQ.data && leadsQ.data.leads) || {}, root = (leadsQ.data && leadsQ.data.root) || "Brahmastra Reports";
  const tl = client && (leads[client.name] || [])[0];
  useEffect(() => {
    window.BRAHMASTRA_REPORTS = { user: me && me.name, leads, root: [root], qaFolder: client && tl ? [root, odName(tl), odName(client.name), "QA tracker"] : [root] };
    return () => { try { delete window.BRAHMASTRA_REPORTS; } catch (e) {} };
  }, [leadsQ.data, client && client.id, me && me.name]);
  return { root, tl, folder: (sub) => [root, tl || "team lead", client ? client.name : "client", sub].join(" › ") };
}
/* The header of each page: who it is for, what it answers, and the frame's buttons. */
function HubHead({ page, onHow, frame, compact }) {
  const p = HUB_PAGES[page];
  return (
    <div className="rh-head">
      <div style={{ minWidth: 0 }}>
        {compact ? <p style={{ margin: 0 }}>{p.desc}</p> : <>
        <div className="rh-eyebrow"><span className={"rh-tag " + p.group}>{p.group === "int" ? "Internal" : "For clients"}</span></div>
        <h1>{p.title}</h1><p>{p.desc}</p></>}
      </div>
      <div className="rh-acts">
        {p.steps && <button className="btn" onClick={onHow}><Ico d={HUB_ICONS.info} size={15} /> How it works</button>}
        {frame && <>
          <button className="btn icon" title="Load again" onClick={frame.reload}><Ico d={HUB_ICONS.reload} size={15} /></button>
          <button className="btn icon" title="Open in its own browser tab (use this if a Microsoft sign-in window does not open here)" onClick={() => window.open(frame.src, "_blank", "noopener")}><Ico d={HUB_ICONS.ext} size={15} /></button>
          <button className="btn icon" title="Full screen" onClick={() => frame.setFull(true)}><Ico d={HUB_ICONS.full} size={15} /></button>
        </>}
      </div>
    </div>
  );
}
function HowDrawer({ page, onClose }) {
  const p = HUB_PAGES[page];
  useEffect(() => { const esc = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, []);
  return (
    <>
      <div className="hist-shade" onClick={onClose} />
      <div className="hist rh-how">
        <div className="hist-top row between"><div><div className="rh-eyebrow"><span className={"rh-tag " + p.group}>{p.group === "int" ? "Internal" : "For clients"}</span>{p.app}</div><h2 style={{ marginTop: 6 }}>How {p.title.toLowerCase()} works</h2></div><button className="btn sm" onClick={onClose}>Close</button></div>
        <div className="hist-body">
          <div className="rh-how-sec"><div className="rh-how-l">What it shows</div><div>{p.what}</div></div>
          <div className="rh-how-sec"><div className="rh-how-l">When to use it</div><div>{p.when}</div></div>
          <div className="rh-how-sec"><div className="rh-how-l">Steps</div>
            {p.steps.map(([t, d], i) => <div key={i} className="rh-how-step"><span className="stepn">{i + 1}</span><div><div className="b">{t}</div><div className="small muted">{d}</div></div></div>)}</div>
          <div className="rh-how-sec"><div className="rh-how-l">Files</div><div>Uploads come only from the Purviewautomate OneDrive. Saved reports go to OneDrive › Brahmastra Reports › team lead › client.</div></div>
        </div>
      </div>
    </>
  );
}
/* The app itself. Its address carries embed=1 (no header of its own) and the Brahmastra theme. */
/* Brahmastra draws the app's own tabs in its tab row: it says 'brahmastra:hello' when the page loads, the page answers
   with 'embed:tabs' (and hides its own tab bar), and a click here sends 'brahmastra:go'. */
function useFrame(base, extra) {
  const [nonce, setNonce] = useState(0);
  const [full, setFull] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tabs, setTabs] = useState([]);
  const win = useRef(null);
  const src = embedUrl(base, extra);
  const origin = (() => { try { return new URL(src, location.href).origin; } catch (e) { return "*"; } })();
  useEffect(() => { setLoading(true); setTabs([]); }, [src, nonce]);
  useEffect(() => { if (!full) return; const esc = (e) => { if (e.key === "Escape") setFull(false); }; window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, [full]);
  useEffect(() => {
    const h = (e) => {
      const w = win.current && win.current.contentWindow;
      if (!w || e.source !== w) return;
      const d = e.data || {};
      // Third Eye's Team Status tab is left out: Brahmastra's Dashboard has Team status from its own data
      if (d.type === "embed:tabs" && Array.isArray(d.tabs)) setTabs(d.tabs.slice(0, 20).map((t) => ({ id: String(t.id).slice(0, 80), label: String(t.label).slice(0, 60), on: !!t.on })).filter((t) => !/^team\s*status$/i.test(t.label)));
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, []);
  const post = (msg) => { try { const w = win.current && win.current.contentWindow; if (w) w.postMessage(msg, origin); } catch (e) {} };
  const hello = () => { post({ type: "brahmastra:hello", v: 1 }); setTimeout(() => post({ type: "brahmastra:hello", v: 1 }), 1200); };
  const go = (id) => { setTabs((ts) => ts.map((t) => ({ ...t, on: t.id === id }))); post({ type: "brahmastra:go", id }); };
  return { src, nonce, full, setFull, loading, setLoading, reload: () => setNonce((n) => n + 1), tabs, go, win, hello };
}
/* The frame of an embedded app, its tabs in Brahmastra's row. `more` adds tabs of Brahmastra's own beside them (the SLA
   scorecard, the Monday digest): `pick` is the one open and `children` what it shows; the frame stays behind, so the
   app's own tabs come back at once. `ready` false keeps the frame out until the sign-in is in place. */
function EmbedPanel({ frame, frameRef, title, onLoad, more = [], pick = null, setPick, ready = true, waitLabel, children }) {
  const setRef = (el) => { frame.win.current = el; if (frameRef) frameRef.current = el; };
  const own = pick != null;
  const tabs = [...frame.tabs.map((t) => ({ ...t, on: !own && t.on })), ...more.map((t) => ({ ...t, on: pick === t.id, own: true }))];
  const open = (t) => { if (t.own) { if (setPick) setPick(t.id); return; } if (own && setPick) setPick(null); frame.go(t.id); };
  return (
    <div className={"rh-frame seam" + (frame.full ? " full" : "")}>
      {frame.full && <div className="rh-fullbar"><b>{title}</b><span className="muted small">Full screen · Esc to leave</span><button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => frame.setFull(false)}>Exit full screen</button></div>}
      {tabs.length > 0 && <div className="ws-tabs" role="tablist">{tabs.map((t) => <button key={(t.own ? "own:" : "app:") + t.id} type="button" role="tab" aria-selected={t.on} className={t.on ? "on" : ""} onClick={() => open(t)}>{t.label}</button>)}</div>}
      {own && <div className="rh-own">{children}</div>}
      {!ready ? (!own && <div className="card"><Spinner label={waitLabel || "Opening " + title + "…"} /></div>)
        : <div className="rh-frame-body" hidden={own}>
          {frame.loading && <div className="rh-loading"><Spinner label={"Opening " + title + "…"} /></div>}
          <iframe key={frame.src + frame.nonce} ref={setRef} src={frame.src} title={title} className="rh-iframe" style={frame.loading ? { visibility: "hidden" } : undefined}
            onLoad={() => { frame.setLoading(false); frame.hello(); onLoad && onLoad(); }} allow="clipboard-write; fullscreen" />
        </div>}
    </div>
  );
}
const timeNow = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function QualityPage({ ctx, me, onHow, lockScope }) {
  const frameRef = useRef(null);
  const today = todayISO();
  const [scope, setScope] = useState(() => { if (lockScope) return lockScope[0]; try { return localStorage.getItem("brahmastra:te-scope") || "ar"; } catch (e) { return "ar"; } });
  const [f, setF] = useState({ client_id: "", location_id: "", range: newRange("month"), roster: true });
  [f.from, f.to] = rangeSpan(f.range);
  const [busy, setBusy] = useState(null);
  const [done, setDone] = useState(null);
  const frame = useFrame(TE_BASE, scope !== "ar" ? "scope=" + scope : "");
  const pickScope = (s) => { setScope(s); setDone(null); try { localStorage.setItem("brahmastra:te-scope", s); } catch (e) {} };
  const client = ctx.clients.find((c) => c.id === f.client_id);
  const rc = useReportsContext(me, client);
  // Brahmastra's own production goes in by itself when the page opens and whenever the work, client or dates change.
  const runRef = useRef(0);
  const send = async (auto) => {
    const run = ++runRef.current;
    const win = frameRef.current && frameRef.current.contentWindow;
    let ready = false;
    try { ready = !!(win && typeof win.handleProd === "function"); } catch (e) { ready = false; }
    if (!ready) { if (!auto) toast("The report is still opening. Wait a moment, then click Load production again.", "err"); return; }
    setBusy("Collecting Brahmastra's production…"); setDone(null);
    try {
      const r = await rpc("reports.production", { scope, client_id: f.client_id || undefined, location_id: f.location_id || undefined, from_ms: dayBounds(f.from)[0], to_ms: dayBounds(f.to)[1] });
      if (run !== runRef.current) return;
      if (!r.rows.length) { if (auto) setDone({ n: 0, people: 0, at: timeNow(), auto }); else toast("Nothing was worked in Brahmastra for these dates" + (client ? " and this client." : "."), "err"); setBusy(null); return; }
      setBusy("Loading the report…");
      const F = win.File || File, label = [client ? client.name : "All clients", TE_SCOPES.find(([k]) => k === scope)[1], f.from + " to " + f.to].join(" - ");
      let people = 0;
      if (f.roster && typeof win.handleRoster === "function") { const rs = rosterSheet(ctx.users); people = rs.rows.length; const b = xlsxBlob(rs.header, rs.rows, "Roster"); await win.handleRoster(new F([b], "Brahmastra team roster.xlsx", { type: b.type })); await new Promise((res) => setTimeout(res, 600)); }
      const pb = xlsxBlob(r.header, r.rows, "Production");
      await win.handleProd(new F([pb], safeName("Brahmastra production - " + label + ".xlsx"), { type: pb.type }));
      setDone({ n: r.rows.length, people, at: timeNow(), auto });
    } catch (e) { if (!auto) toast(e.message, "err"); }
    setBusy(null);
  };
  useEffect(() => {
    if (frame.loading) return;
    const id = setTimeout(() => send(true), 700);
    return () => clearTimeout(id);
  }, [frame.loading, frame.nonce, scope, f.client_id, f.location_id, f.from, f.to, f.roster]);
  return (
    <div>
      <HubHead page="quality" onHow={onHow} frame={frame} />
      <div className="card rh-bar">
        <Field label="Work"><div className="seg2">{TE_SCOPES.filter(([k]) => !lockScope || lockScope.includes(k)).map(([k, l]) => <button key={k} className={scope === k ? "on" : ""} onClick={() => pickScope(k)}>{l}</button>)}</div></Field>
        <ClientPicker ctx={ctx} clientId={f.client_id} setClientId={(v) => setF((x) => ({ ...x, client_id: v, location_id: "" }))} locId={f.location_id} setLocId={(v) => setF((x) => ({ ...x, location_id: v }))} allowAll allLabel="All my clients" />
        <DateRange value={f.range} onChange={(r) => setF({ ...f, range: r })} />
        <button className="btn primary rh-go" disabled={!!busy || frame.loading} onClick={() => send(false)}>{busy || (done ? "Load again" : "Load production")}</button>
      </div>
      <div className="rh-status">
        <span><i className={"rh-dot" + (done && done.n ? "" : done ? " wait" : " off")} />{done && done.n ? <>Production from Brahmastra · {fmtInt(done.n)} {done.n === 1 ? "entry" : "entries"} · {done.at}</> : done ? "No Brahmastra entries for these dates" : busy ? "Loading Brahmastra's production…" : "Production loads by itself"}</span>
        <label className="check small" style={{ gap: 6 }}><input type="checkbox" checked={f.roster} onChange={(e) => setF({ ...f, roster: e.target.checked })} />{done && done.people ? <>Roster · {fmtInt(done.people)} people</> : "Load the team roster too"}</label>
        <span><i className="rh-dot off" />QA tracker: pick it in the QA Sheet box below, from {rc.folder("QA tracker")}</span>
      </div>
      {done && <div className="alert info mb rh-note"><b>{done.n ? "Already filled from Brahmastra." : "Nothing from Brahmastra for these dates."}</b> {done.n
        ? <>The Production Sheet below holds Brahmastra's {fmtInt(done.n)} {done.n === 1 ? "entry" : "entries"} for {TE_SCOPES.find(([k]) => k === scope)[1]}, {client ? client.name : "all your clients"}, {rangeText(f.range)}{done.people ? <>, with the roster ({fmtInt(done.people)} people)</> : null}. To use a different file, choose it in the Production Sheet box below; changing the work, client or dates here loads Brahmastra's again.</>
        : <>Choose a Production Sheet in the box below, or change the dates here.</>}</div>}
      <EmbedPanel frame={frame} frameRef={frameRef} title="Internal reports" onLoad={() => setDone(null)} />
    </div>
  );
}
/* ======================= Client report (Client 360 › Client report) =======================
   Sasha's Third Eye's client report (its client.html), page for page and rule for rule, built from Brahmastra's own data
   instead of uploaded sheets: the inventory at the period end against the end of the period before, AR work entries, the
   Payment posting, Submission and Rejections desks and the requests waiting on the client. Same pages, KPIs, charts,
   Pareto 80% rule, mover insights and RCA table; plus a cover and an executive summary. Supervisors edit the words (kept
   in Brahmastra for the client and period), every chart filters the page like Power BI, Present shows it full screen and
   the PDF prints one widescreen page per slide. */
const CRM_S = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CRM_L = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CRM_IDX = (() => { const m = {}; CRM_L.forEach((n, i) => { m[n.toLowerCase()] = i; m[n.slice(0, 3).toLowerCase()] = i; }); m.sept = 8; return m; })();
const crEsc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const crSum = (arr, f) => arr.reduce((a, x) => a + (f ? (Number(f(x)) || 0) : (Number(x) || 0)), 0);
const crUniq = (arr) => Array.from(new Set(arr));
const crClamp = (v, a, b) => Math.max(a, Math.min(b, v));
const crTrunc = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const crN = (rows) => crSum(rows, (r) => r._n || 1);   // claims in a set (a kept snapshot holds cells of several claims)
const crPl = (n, one, many) => crF.int(n) + " " + (Math.round(n) === 1 ? one : many || one + "s");
const crMoneySub = (v) => (crF.moneyK(v) !== crF.money(v, 0) ? crF.money(v, 0) : "");
const crF = {
  int: (n) => (n == null || isNaN(n)) ? "–" : Math.round(n).toLocaleString("en-US"),
  money: (n, d) => { if (n == null || isNaN(n)) return "–"; const neg = n < 0, v = Math.abs(n), dd = d == null ? (v < 1000 ? 2 : 0) : d; return (neg ? "-$" : "$") + v.toLocaleString("en-US", { minimumFractionDigits: dd, maximumFractionDigits: dd }); },
  moneyK: (n) => { if (n == null || isNaN(n)) return "–"; const neg = n < 0, v = Math.abs(n); const s = v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 1 : 2) + "M" : v >= 1e4 ? (v / 1e3).toFixed(v >= 1e5 ? 0 : 1) + "K" : v.toLocaleString("en-US", { maximumFractionDigits: 0 }); return (neg ? "-$" : "$") + s; },
  num: (n) => (n == null || isNaN(n)) ? "–" : (Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(1) + "K" : Math.round(n).toLocaleString("en-US")),
  pct: (n, d = 0) => (n == null || isNaN(n) || !isFinite(n)) ? "–" : (n * 100).toFixed(d) + "%",
  date: (d) => d ? `${String(d.getDate()).padStart(2, "0")} ${CRM_S[d.getMonth()]} ${d.getFullYear()}` : "–",
  dateShort: (d) => d ? `${String(d.getDate()).padStart(2, "0")} ${CRM_S[d.getMonth()]}` : "–",
  iso: (d) => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "",
  monthYear: (d) => d ? `${CRM_L[d.getMonth()]} ${d.getFullYear()}` : "–",
  signed: (n, f) => n == null || isNaN(n) ? "–" : (n > 0 ? "+" : "") + f(n),
};
/* dates (local, day precision) */
const crD = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const crDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const crAddD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const crAddM = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const crMS = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const crME = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const crWS = (d) => { const x = crDay(d); return crAddD(x, -((x.getDay() + 6) % 7)); };   // Monday
const crDaysBetween = (a, b) => Math.round((crDay(b) - crDay(a)) / 86400000) + 1;
const crWorkingDays = (a, b) => { let n = 0; for (let d = crDay(a); d <= b; d = crAddD(d, 1)) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; } return n; };
/* report periods: a month, a week (Monday to Sunday) or custom dates; the period before has the same length */
const crRangeMonth = (d) => ({ start: crMS(d), end: crME(d), kind: "month" });
const crRangeWeek = (d) => ({ start: crWS(d), end: crAddD(crWS(d), 6), kind: "week" });
const crRangeCustom = (a, b) => ({ start: crDay(a), end: crDay(b), kind: "custom" });
function crShift(r, n = -1) {
  if (!r) return null;
  if (r.kind === "month") return crRangeMonth(crAddM(r.start, n));
  if (r.kind === "week") return crRangeWeek(crAddD(r.start, 7 * n));
  const len = crDaysBetween(r.start, r.end); return { start: crAddD(r.start, len * n), end: crAddD(r.end, len * n), kind: "custom" };
}
function crRangeLabel(r) {
  if (!r) return "All data";
  if (r.kind === "month") return crF.monthYear(r.start);
  if (r.start.getFullYear() === r.end.getFullYear() && r.start.getMonth() === r.end.getMonth()) return `${String(r.start.getDate()).padStart(2, "0")} to ${String(r.end.getDate()).padStart(2, "0")} ${CRM_S[r.start.getMonth()]} ${r.start.getFullYear()}`;
  return `${crF.dateShort(r.start)} to ${crF.date(r.end)}`;
}
const crInRange = (d, r) => !r || (d && d >= r.start && d <= r.end);
const crPeriodKey = (r) => r.kind === "month" ? "month:" + crF.iso(r.start).slice(0, 7) : r.kind === "week" ? "week:" + crF.iso(r.start) : "custom:" + crF.iso(r.start) + ":" + crF.iso(r.end);
/* text, categories and payer names (as Third Eye: spelling variants share one key; payers merge obvious aliases) */
const crClean = (v) => { if (v == null) return ""; const s = String(v).replace(/ /g, " ").replace(/\s+/g, " ").trim(); return /^(#n\/a|#ref!|#value!|n\/a|na|-|--|none|null|undefined)$/i.test(s) ? "" : s; };
const crTitle = (s) => s.replace(/\w\S*/g, (w) => w.length > 3 || /^[a-z]/.test(w) ? w[0].toUpperCase() + w.slice(1) : w);
class CrCat {
  constructor() { this.map = new Map(); }
  add(raw) { const s = crClean(raw); if (!s) return ""; const k = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); let e = this.map.get(k); if (!e) { e = { variants: new Map(), label: s }; this.map.set(k, e); } e.variants.set(s, (e.variants.get(s) || 0) + 1); return k; }
  finalize() { for (const e of this.map.values()) { let best = null, n = -1; for (const [v, c] of e.variants) if (c > n) { n = c; best = v; } e.label = best; } }
}
function crPayerKey(raw) {
  let s = crClean(raw).toLowerCase(); if (!s) return "";
  s = s.replace(/[,.()\-\/]/g, " ").replace(/\b(of|the|inc|llc|ltd|co|plan|plans|health plan|healthplan)\b/g, " ").replace(/\s+/g, " ").trim();
  const rules = [[/superior/, "superior health plan"], [/molina/, "molina healthcare"], [/\bmedicare\b|cgs|noridian|dme mac|jurisdiction/, "medicare"], [/tmhp|texas medicaid/, "texas medicaid"],
    [/\buhc\b|united ?health/, "united healthcare"], [/\bbcbs\b|blue cross|blue shield/, "bcbs"], [/\baetna\b/, "aetna"], [/\bcigna\b/, "cigna"], [/\bhumana\b/, "humana"], [/\bambetter\b/, "ambetter"],
    [/\bamerigroup\b/, "amerigroup"], [/\btricare\b/, "tricare"], [/\bwellmed\b/, "wellmed"]];
  for (const [re, k] of rules) if (re.test(s)) return k;
  return s;
}
/* aging groups: the same seven as Third Eye */
const CR_BK = [["0-30", "0 to 30 days", 0], ["31-60", "31 to 60 days", 31], ["61-90", "61 to 90 days", 61], ["91-120", "91 to 120 days", 91], ["121-180", "121 to 180 days", 121], ["181-365", "181 to 365 days", 181], ["366+", "366+ days", 366]];
const CR_BK_BY = Object.fromEntries(CR_BK.map(([k, l, lo]) => [k, { key: k, label: l, lo }]));
/* one dataset: records with canonical fields (keys for categories, labels kept apart), like Third Eye's normalised sheets */
const CR_CATS = ["payer", "pmsStatus", "status", "action", "moveTo", "purviewStatus", "workBy", "week", "carrier", "dept"];
function crDataset(role, rows, map, opts = {}) {
  const cats = {}; for (const f of CR_CATS) cats[f] = new CrCat();
  const payerCnt = new Map();
  const recs = rows.map((x, i) => {
    const v = map(x);
    const rec = { _i: i, _n: v._n || 1, id: v.id || "", invoice: v.invoice || "", dos: crD(v.dos), workDate: crD(v.workDate), subDate: crD(v.subDate), paidDate: crD(v.paidDate),
      charge: v.charge == null ? null : v.charge, balance: v.balance == null ? null : v.balance, paid: v.paid == null ? null : v.paid, amount: Number(v.amount) || 0, aging: v.aging == null ? null : v.aging,
      submitted: v.submitted == null ? null : v.submitted, comment: v.comment || "", checkNo: v.checkNo || "", open: v.open, loc: v.loc || "" };
    const b = CR_BK_BY[v.bucket] || null; rec.bucket = b ? b.key : ""; rec.bucketLabel = b ? b.label : ""; rec.bucketLo = b ? b.lo : 9999;
    for (const f of CR_CATS) rec[f] = v[f] == null ? "" : cats[f].add(v[f]);
    rec.payerKey = crPayerKey(v.payer);
    if (rec.payerKey) { const m = payerCnt.get(rec.payerKey) || new Map(), raw = crClean(v.payer); m.set(raw, (m.get(raw) || 0) + (v._n || 1)); payerCnt.set(rec.payerKey, m); }
    return rec;
  });
  for (const c of Object.values(cats)) c.finalize();
  const labels = {}; for (const f of CR_CATS) labels[f] = Object.fromEntries([...cats[f].map].map(([k, e]) => [k, e.label]));
  labels.payerKey = Object.fromEntries([...payerCnt].map(([k, m]) => [k, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  labels.bucket = Object.fromEntries(CR_BK.map(([k, l]) => [k, l]));
  return { role, recs, labels, dateField: opts.dateField || null, extras: [], nrows: recs.length, source: opts.source || "", asOf: opts.asOf || "", derivedFrom: opts.derivedFrom || null, cells: !!opts.cells };
}
/* Brahmastra's records → Third Eye's datasets */
function crDatasets(raw) {
  const d = raw.data, out = {};
  const inv = (x, cells) => cells
    ? crDataset("inventory", x.cells, (c) => ({ _n: c.n, payer: c.py, amount: c.amt, balance: c.amt, bucket: c.bk, purviewStatus: c.st || "Not worked yet", pmsStatus: c.pms, action: c.act, loc: c.loc }), { source: x.source, asOf: x.as_of, cells: true })
    : crDataset("inventory", x.rows, (r) => ({ id: r.id, invoice: r.no, dos: r.dos, payer: r.py, amount: r.amt, balance: r.amt, charge: r.chg, aging: r.age, bucket: r.bk, purviewStatus: r.st || "Not worked yet",
      pmsStatus: r.pms, status: r.sub, action: r.act, moveTo: r.mv, workDate: r.wd, workBy: r.by, loc: r.loc }), { source: x.source, asOf: x.as_of });
  out.inventory = inv(d.inventory, !!d.inventory.cells);
  out.inventoryPrev = inv(d.inventoryPrev, !!d.inventoryPrev.cells); out.inventoryPrev.role = "inventoryPrev";
  out.worked = crDataset("worked", d.worked, (r) => ({ id: r.id, invoice: r.no, dos: r.dos, payer: r.py, charge: r.chg, balance: r.amt, amount: r.chg != null ? r.chg : r.amt, bucket: r.bk,
    purviewStatus: r.st, status: r.sub, action: r.act, moveTo: r.mv, workDate: r.wd, workBy: r.by, loc: r.loc }), { dateField: "workDate" });
  out.payment = crDataset("payment", d.payment, (r) => ({ id: r.id, invoice: r.no, dos: r.dos, payer: r.py, checkNo: r.chk, paidDate: r.pd, paid: r.paid, charge: r.chg,
    amount: r.paid != null ? r.paid : 0, status: r.st, week: r.wk, workDate: r.d, workBy: r.by, loc: r.loc }), { dateField: "workDate" });
  out.submission = crDataset("submission", d.submission, (r) => ({ id: r.id, invoice: r.no, dos: r.dos, payer: r.py, charge: r.chg, amount: r.chg || 0, submitted: r.ok, status: r.st,
    comment: r.cm, carrier: r.mode, subDate: r.sd, workBy: r.by, loc: r.loc }), { dateField: "subDate" });
  out.rejection = crDataset("rejection", d.rejection, (r) => ({ id: r.id, invoice: r.no, dos: r.dos, payer: r.py, charge: r.chg, balance: r.amt, amount: r.chg != null ? r.chg : r.amt,
    status: r.st, action: r.act, workDate: r.wd, workBy: r.by, loc: r.loc }), { dateField: "workDate" });
  // waiting on the client: the desks' requests, and AR entries whose ball went to the client
  const arCa = d.worked.filter((r) => /client/i.test(r.mv || "") || /client/i.test(r.act || ""));
  out.clientAssistance = crDataset("clientAssistance", [...d.clientAssistance.map((r) => ({ ...r, _src: "desk" })), ...arCa.map((r) => ({ ...r, _src: "ar" }))], (r) => r._src === "desk"
    ? { id: r.id, invoice: r.no, dos: r.dos, payer: r.py, amount: r.amt, balance: r.amt, bucket: r.bk, status: r.st, action: r.act, workDate: r.wd, open: r.open, dept: r.dept, comment: r.cm, loc: r.loc }
    : { id: r.id, invoice: r.no, dos: r.dos, payer: r.py, amount: r.amt, balance: r.amt, bucket: r.bk, status: r.sub || "Information from the client", action: r.act || "Waiting on the client", workDate: r.wd, dept: "AR", workBy: r.by, loc: r.loc },
    { dateField: "workDate" });
  // eligibility checks: the EV production file uploaded for the client (Brahmastra does not do EV itself)
  if (d.ev && d.ev.length) out.ev = crDataset("ev", d.ev, (r) => ({ id: r.id, invoice: r.no, dos: r.dos, payer: r.py, status: r.st, action: r.act, workDate: r.wd, workBy: r.by, comment: r.cm, loc: r.loc }), { dateField: "workDate" });
  return out;
}
/* ---------- aggregation (Third Eye's agg, Pareto, folding, cross-filter) ---------- */
function crLabelOf(ds, field, key) {
  if (!key) return "(blank)";
  if (field === "payerKey") return (ds.labels.payerKey && ds.labels.payerKey[key]) || crTitle(key);
  if (field === "bucket") return (ds.labels.bucket && ds.labels.bucket[key]) || key;
  const L = ds.labels[field]; return (L && L[key]) || crTitle(key);
}
const crWeekSort = (lbl) => { const s = String(lbl).toLowerCase(); const mm = s.match(/[a-z]{3,}/); const wk = s.match(/(\d+)/); const mi = mm ? (CRM_IDX[mm[0].slice(0, 3)] ?? 50) : 50; return mi * 10 + (wk ? +wk[1] : 0); };
function crAgg(rows, field, ds, opts = {}) {
  const measure = opts.measure || "count", m = new Map();
  for (const r of rows) { const k = r[field] == null ? "" : String(r[field]); let e = m.get(k); if (!e) { e = { key: k, count: 0, amount: 0, lo: r.bucketLo }; m.set(k, e); } e.count += r._n || 1; e.amount += Number(r.amount) || 0; }
  let items = [...m.values()].map((e) => ({ ...e, label: crLabelOf(ds, field, e.key), value: measure === "amount" ? e.amount : e.count }));
  if (!opts.keepBlank) items = items.filter((x) => x.key !== "" || items.length === 1);
  const total = crSum(items, (x) => x.value) || 1; items.forEach((x) => { x.share = x.value / total; });
  if (field === "bucket") items.sort((a, b) => a.lo - b.lo);
  else if (opts.order === "label") items.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  else if (opts.order === "week") items.sort((a, b) => crWeekSort(a.label) - crWeekSort(b.label));
  else items.sort((a, b) => b.value - a.value);
  return items;
}
const crMarkSel = (items, selSet) => { if (!selSet || !selSet.size) return items; for (const x of items) { x.sel = selSet.has(x.key); x.dim = !x.sel; } return items; };
const crEmph80 = (items) => { let cum = 0, reached = false; const total = crSum(items, (x) => x.value) || 1; for (const x of items) { cum += x.value; x.cum = cum / total; x.emph = !reached; if (x.cum >= 0.8) reached = true; } return items; };
const crFold = (items, n, other = "Other") => { if (items.length <= n) return items; const head = items.slice(0, n - 1), tail = items.slice(n - 1); return head.concat([{ key: "__other", label: `${other} (${tail.length})`, count: crSum(tail, (x) => x.count), amount: crSum(tail, (x) => x.amount), value: crSum(tail, (x) => x.value), share: crSum(tail, (x) => x.share), isOther: true }]); };
const crApplySel = (rows, sel, except) => { const fields = Object.keys(sel || {}).filter((f) => f !== except && sel[f] && sel[f].size && rows.some((r) => r[f] != null && r[f] !== "")); if (!fields.length) return rows; return rows.filter((r) => fields.every((f) => sel[f].has(String(r[f] == null ? "" : r[f])))); };
function crTrendPoints(rows, dateField, range, grain) {
  if (!rows.length || !dateField) return [];
  const m = new Map();
  for (const r of rows) { const d = r[dateField]; if (!d) continue; let k, lbl, x; if (grain === "month") { x = crMS(d); lbl = `${CRM_S[x.getMonth()]} ${String(x.getFullYear()).slice(2)}`; } else if (grain === "week") { x = crWS(d); lbl = crF.dateShort(x); } else { x = crDay(d); lbl = crF.dateShort(x); } k = crF.iso(x);
    let e = m.get(k); if (!e) { e = { x, label: lbl, count: 0, amount: 0 }; m.set(k, e); } e.count += r._n || 1; e.amount += Number(r.amount) || 0; }
  let pts = [...m.values()].sort((a, b) => a.x - b.x);
  if (grain === "day" && range && crDaysBetween(range.start, range.end) <= 62) { const out = []; for (let d = crDay(range.start); d <= range.end; d = crAddD(d, 1)) { const k = crF.iso(d); out.push(m.get(k) || { x: d, label: crF.dateShort(d), count: 0, amount: 0 }); } pts = out; }
  return pts;
}
const crGrain = (range) => { if (!range) return "month"; const n = crDaysBetween(range.start, range.end); return n <= 62 ? "day" : n <= 200 ? "week" : "month"; };
const crDelta = (cur, prev) => (prev == null || cur == null ? null : { cur, prev, diff: cur - prev, pct: prev ? (cur - prev) / Math.abs(prev) : null });
const crPctOf = (a, b) => (b ? a / b : null);
const crListNames = (items, n = 3) => { const names = items.slice(0, n).map((x) => x.label); const more = items.length - names.length; if (names.length <= 1) return names.join("") + (more > 0 ? ` and ${more} more` : ""); if (more > 0) return names.join(", ") + ` and ${more} more`; return names.slice(0, -1).join(", ") + " and " + names[names.length - 1]; };
const crWorkingDaysIn = (range, rows, dateField) => { if (range) return crWorkingDays(range.start, range.end); const ds = rows.map((r) => r[dateField]).filter(Boolean); if (!ds.length) return null; return crWorkingDays(new Date(Math.min(...ds)), new Date(Math.max(...ds))); };
/* how Third Eye reads a row */
const crIsClosed = (r) => { if (r.moveTo) return /close/.test(r.moveTo); if (r.pmsStatus) return /closed|paid/.test(r.pmsStatus); if (r.purviewStatus) return /paid|non collect|closed|adjust/.test(r.purviewStatus); return false; };
const crIsRejected = (r) => /reject/.test(r.purviewStatus || "") || /reject/.test(r.pmsStatus || "") || (!r.purviewStatus && !r.pmsStatus && /reject/.test(r.status || ""));
const crIsDenied = (r) => { if (r.purviewStatus) return /deni|denial/.test(r.purviewStatus); if (r.pmsStatus && /deni/.test(r.pmsStatus)) return true; return /deni|denial/.test(r.status || ""); };
const crIsPaid = (r) => /paid/.test(r.purviewStatus || "") || (!r.purviewStatus && /paid/.test(r.status || ""));
const crSubState = (r) => { const st = r.status || ""; if (/dup/.test(st)) return "duplicate"; if (r.submitted === false || /not submit|unsubmit|pending|hold/.test(st)) return "not"; if (r.submitted === true || /submit|sent|billed/.test(st) || (!st && r.submitted == null)) return "submitted"; return "other"; };
/* the datasets a page reads; denials come from the AR entries (as Third Eye does without a denial sheet) */
function crDerived(DS, role) {
  if (role === "denial") { const w = DS.worked; const recs = w ? w.recs.filter(crIsDenied) : []; return recs.length ? { ...w, role, recs, nrows: recs.length, derivedFrom: "worked" } : null; }
  if (role === "rejection") { const r = DS.rejection; if (r && r.recs.length) return r; const w = DS.worked; const recs = w ? w.recs.filter(crIsRejected) : []; return recs.length ? { ...w, role, recs, nrows: recs.length, derivedFrom: "worked" } : null; }
  const ds = DS[role]; return ds && ds.recs.length ? ds : null;
}
/* the page context: rows in the period (with the cross-filter), rows in the period before, the inventory snapshots */
function crCtx(DS, R, pageId, sel) {
  const range = R.range, prevRange = R.compare ? crShift(range) : null, cache = {};
  const get = (role) => { if (!cache[role]) { const ds = crDerived(DS, role); const of = (rg) => !ds ? [] : ds.dateField && rg ? ds.recs.filter((r) => crInRange(r[ds.dateField], rg)) : ds.recs.slice();
    cache[role] = { ds, all: of(range), prevAll: prevRange ? of(prevRange) : [] }; } return cache[role]; };
  return { pageId, sel, range, prevRange, ds: (role) => get(role).ds, rows: (role, except) => crApplySel(get(role).all, sel, except), rowsAll: (role) => get(role).all,
    prev: (role) => crApplySel(get(role).prevAll, sel, null), hasPrev: (role) => !!(prevRange && get(role).prevAll.length),
    snapshot: (role) => { const ds = DS[role]; return ds ? ds.recs : []; }, DS, R };
}
/* ---------- card factories and insight helpers (Third Eye's) ---------- */
const CR_MEASURE = { count: { label: "Claims", fmt: crF.int }, amount: { label: "Amount", fmt: crF.money } };
const crDimLabel = (ds, field) => ({ payerKey: "Payer", bucket: "Aging bucket", workBy: "Worked by", purviewStatus: "Status", pmsStatus: "PMS status", status: "Status / reason", action: "Action", moveTo: "Ball with", week: "Week", carrier: "Submission mode", dept: "Team", loc: "Location" }[field] || crTitle(field));
function crCardBar(c, field, title, opts = {}) {
  const role = opts.role, ds = c.ds(role); if (!ds) return null;
  const id = `${c.pageId}.${role}.${field}`;
  let rows = c.rows(role, field); if (opts.rowFilter) rows = rows.filter(opts.rowFilter);
  const measure = (c.R.cardMeasure && c.R.cardMeasure[id]) || opts.measure || "count";
  let items = crAgg(rows, field, ds, { measure, order: opts.order });
  if (opts.filterItems) items = items.filter(opts.filterItems);
  if (!items.length) return { id, title, sub: opts.sub, cols: opts.cols || 6, type: "empty" };
  if (opts.emph) crEmph80(items);
  crMarkSel(items, c.sel[field]);
  let prevRows = opts.prev && c.hasPrev(role) ? c.prev(role) : null; if (prevRows && opts.rowFilter) prevRows = prevRows.filter(opts.rowFilter);
  const prevItems = prevRows ? crAgg(prevRows, field, ds, { measure }) : null;
  const m = CR_MEASURE[measure], sec = measure === "count" ? { key: "amount", label: "Amount", fmt: crF.money } : { key: "count", label: "Claims", fmt: crF.int };
  return { id, title, sub: opts.sub, cols: opts.cols || 6, type: opts.type || "hbar", dim: field, dimLabel: crDimLabel(ds, field), items, prevItems, measure, canToggle: true, measureLabel: m.label,
    fmtV: measure === "amount" ? crF.moneyK : crF.int, fmtT: m.fmt, secondary: sec, emphasis: !!opts.emph, maxRows: opts.maxRows || 14, height: opts.height, note: opts.note, callout: opts.callout };
}
const crAddCard = (cards, card, min = 2) => { if (!card || card.type === "empty") return; if (card.items && card.items.length < min) return; cards.push(card); };
const crKpi = (label, value, o = {}) => ({ label, value, sub: o.sub, delta: o.delta, upGood: o.upGood !== false, fmt: o.fmt, accent: o.accent, small: o.small, spark: o.spark });
const crPrevWord = (R) => R.range.kind === "week" ? "previous week" : R.range.kind === "month" ? "previous month" : "previous period";
const crPeriodWord = (R) => R.range.kind === "week" ? "Weekly" : R.range.kind === "month" ? "Monthly" : "Period";
const crPctWord = (d) => d.pct == null ? crF.signed(d.diff, crF.int) : crF.pct(Math.abs(d.pct), 0);
function crHeadline(R, label, cur, prev, f, o = {}) {
  const d = crDelta(cur, prev); if (!d || (!cur && !prev)) return null;
  if (d.diff === 0) return `${label} ${o.plural ? "are" : "is"} unchanged against the ${crPrevWord(R)} (${f(prev)}).`;
  const verb = d.diff > 0 ? (o.up || "rose") : (o.down || "fell");
  return `${label} ${verb} ${d.pct == null ? "by " + f(Math.abs(d.diff)) : crF.pct(Math.abs(d.pct), 0)} against the ${crPrevWord(R)}: ${f(prev)} to ${f(cur)}.`;
}
const CR_PLURAL = { payer: "payers", reason: "reasons", status: "statuses", action: "actions", "aging bucket": "aging buckets", carrier: "carrier groups", week: "weeks", "worked by": "billers" };
function crMovers(R, curRows, prevRows, field, ds, o = {}) {
  if (!prevRows || !prevRows.length || !curRows.length) return [];
  const measure = o.measure || "count", f = measure === "amount" ? (v) => crF.money(v, 0) : crF.int;
  const noun = o.noun || crDimLabel(ds, field).toLowerCase(), plural = o.plural || CR_PLURAL[noun] || (noun.endsWith("s") ? noun : noun + "s"), pw = crPrevWord(R);
  const cur = crAgg(curRows, field, ds, { measure }), prev = crAgg(prevRows, field, ds, { measure });
  const keys = crUniq([...cur.map((x) => x.key), ...prev.map((x) => x.key)]);
  const rows = keys.map((k) => { const a = cur.find((x) => x.key === k), b = prev.find((x) => x.key === k); return { key: k, label: (a || b).label, cur: a ? a.value : 0, prev: b ? b.value : 0, curShare: a ? a.share : 0, prevShare: b ? b.share : 0, diff: (a ? a.value : 0) - (b ? b.value : 0) }; });
  // movements too small to matter are left out: at least 3 claims or $500, and 5% of this period's total
  const total = crSum(cur, (x) => x.value) || 1, minDiff = o.minDiff != null ? o.minDiff : Math.max(measure === "amount" ? 500 : 3, 0.05 * total);
  const pctPart = (r) => (measure === "amount" ? r.prev >= 1000 : r.prev >= 10) ? ", " + crF.pct(Math.abs(r.diff) / r.prev, 0) : "";
  const out = [];
  const up = rows.filter((r) => r.diff >= minDiff).sort((a, b) => b.diff - a.diff)[0], down = rows.filter((r) => -r.diff >= minDiff).sort((a, b) => a.diff - b.diff)[0];
  if (up) out.push(up.prev === 0 ? `${up.label} is new this period among ${plural}: ${f(up.cur)} now, none in the ${pw}.` : `${up.label} grew the most among ${plural}: ${f(up.prev)} in the ${pw} to ${f(up.cur)} now (+${f(up.diff)}${pctPart(up)}).`);
  if (down) out.push(`${down.label} dropped the most: ${f(down.prev)} to ${f(down.cur)} (${f(down.diff)}${pctPart(down)}).`);
  const top = cur[0]; if (top && o.share !== false) { const p = rows.find((r) => r.key === top.key); if (p && p.prevShare && Math.abs(p.curShare - p.prevShare) >= 0.03) out.push(`${top.label}'s share of the ${o.shareOf || "total"} moved from ${crF.pct(p.prevShare, 0)} to ${crF.pct(p.curShare, 0)}.`); }
  const fresh = rows.filter((r) => r.prev === 0 && r.cur >= minDiff && (!up || r.key !== up.key)).sort((a, b) => b.cur - a.cur);
  if (o.newItems && fresh.length) out.push(`Also new this period: ${crListNames(fresh, 3)} (not seen in the ${pw}).`);
  const gone = rows.filter((r) => r.cur === 0 && r.prev >= minDiff).sort((a, b) => b.prev - a.prev);
  if (o.newItems && gone.length) out.push(`No longer appearing: ${crListNames(gone, 3)} (${f(crSum(gone, (r) => r.prev))} in the ${pw}).`);
  return out;
}
const CR_CLAIM_COLS = {
  inventory: ["invoice", "dos", "bucket", "payerKey", "amount", "purviewStatus", "status", "action", "workDate", "workBy"],
  submission: ["invoice", "dos", "payerKey", "amount", "subDate", "status", "comment", "workBy"],
  worked: ["invoice", "dos", "bucket", "payerKey", "amount", "purviewStatus", "status", "action", "workDate", "workBy"],
  payment: ["invoice", "dos", "payerKey", "checkNo", "paidDate", "charge", "paid", "status", "workBy"],
  rejection: ["invoice", "dos", "payerKey", "amount", "status", "action", "workDate", "workBy"],
  denial: ["invoice", "dos", "bucket", "payerKey", "amount", "status", "action", "workDate", "workBy"],
  ev: ["invoice", "dos", "payerKey", "status", "action", "workDate", "workBy", "comment"],
  clientAssistance: ["invoice", "dos", "bucket", "payerKey", "amount", "status", "action", "dept", "workDate", "comment"],
};
const crClaims = (ds, rows, role) => ({ ds, rows, cols: CR_CLAIM_COLS[role] || CR_CLAIM_COLS.worked });
/* ---------- the pages: Third Eye's builders, one by one ---------- */
function crInvSets(c) {
  const DS = c.DS, ds = DS.inventory, curAll = ds ? ds.recs : [], cur = crApplySel(curAll, c.sel, null);
  const prevDs = DS.inventoryPrev && DS.inventoryPrev.recs.length ? DS.inventoryPrev : null;
  const two = !!prevDs, pw = crPrevWord(c.R);
  const prev = crApplySel(two ? prevDs.recs : curAll, c.sel, null);
  const asOf = (x) => crF.date(crD(x.asOf));
  return { ds, cur, curAll, prev, prevSet: prev, curSet: two ? cur : cur.filter((r) => !crIsClosed(r)), twoSnapshots: two, prevDs,
    prevLabel: two ? `AR · ${asOf(prevDs)}` : "Inventory received", curLabel: two ? `AR · ${asOf(ds)}` : "Still open", pw,
    rebuilt: two && prevDs.source === "rebuilt" ? prevDs.asOf : null };
}
function crBuildInventory(c) {
  const R = c.R, { ds, prevSet, curSet, twoSnapshots, prevLabel, curLabel, rebuilt } = crInvSets(c);
  const amtPrev = crSum(prevSet, (r) => r.amount), amtCur = crSum(curSet, (r) => r.amount), nPrev = crN(prevSet), nCur = crN(curSet);
  const red = amtPrev ? 1 - amtCur / amtPrev : null;
  const over = (set) => crSum(set.filter((r) => r.bucketLo >= 91), (r) => r.amount);
  const o90 = amtCur ? over(curSet) / amtCur : null, o90p = amtPrev ? over(prevSet) / amtPrev : null;
  const kpis = [
    crKpi(prevLabel, crF.money(amtPrev, 0), { sub: `${crF.int(nPrev)} claims` }),
    crKpi(red != null && red >= 0 ? "Reduction" : "Change", red == null ? "–" : crF.pct(Math.abs(red), 1), { sub: red == null ? "" : `${crF.money(Math.abs(amtPrev - amtCur), 0)} ${red >= 0 ? "cleared" : "added"}${nPrev !== nCur ? " · " + crPl(Math.abs(nPrev - nCur), "claim") : ""}`, accent: true }),
    crKpi(curLabel, crF.money(amtCur, 0), { sub: `${crF.int(nCur)} claims`, delta: twoSnapshots ? crDelta(amtCur, amtPrev) : null, upGood: false, fmt: crF.moneyK }),
    crKpi("Over 90 days", o90 == null ? "–" : crF.pct(o90, 1), { sub: o90p == null ? "of the open balance" : `was ${crF.pct(o90p, 1)}`, delta: o90 != null && o90p != null ? { cur: o90, prev: o90p, diff: o90 - o90p, pct: null, pts: true } : null, upGood: false }),
  ];
  const bP = crAgg(prevSet, "bucket", ds, { measure: "amount" }), bC = crAgg(curSet, "bucket", ds, { measure: "amount" }), bPc = crAgg(prevSet, "bucket", ds), bCc = crAgg(curSet, "bucket", ds);
  crMarkSel(bP, c.sel.bucket); crMarkSel(bC, c.sel.bucket);
  const keys = crUniq([...bP.map((x) => x.key), ...bC.map((x) => x.key)]).map((k) => ({ k, lo: (bP.find((x) => x.key === k) || bC.find((x) => x.key === k)).lo })).sort((a, b) => a.lo - b.lo).map((x) => x.k);
  const mk = (P, Q) => keys.map((k) => { const p = P.find((x) => x.key === k), q = Q.find((x) => x.key === k); const pv = p ? p.value : 0, cv = q ? q.value : 0; return { key: k, label: crLabelOf(ds, "bucket", k), value: pv - cv, prev: pv, cur: cv, dim: c.sel.bucket && c.sel.bucket.size && !c.sel.bucket.has(k) }; });
  const redAmt = mk(bP, bC), redCnt = mk(bPc, bCc);
  const grouped = keys.map((k) => { const p = bP.find((x) => x.key === k), q = bC.find((x) => x.key === k); return { key: k, label: k + "", prev: p ? p.value : 0, cur: q ? q.value : 0, dim: c.sel.bucket && c.sel.bucket.size && !c.sel.bucket.has(k), sel: c.sel.bucket && c.sel.bucket.has(k) }; });
  const cards = [
    { id: "inv.bucket.both", title: `Aging, ${twoSnapshots ? "then against now" : "received against still open"}`, sub: "Balance by age of claim", cols: 7, type: "grouped", dim: "bucket", items: grouped, fmtV: crF.moneyK, labels: [prevLabel, curLabel] },
    { id: "inv.red.amt", title: "What changed in each age group", sub: "Balance cleared (right) or added (left)", cols: 5, type: "diverge", dim: "bucket", items: redAmt, fmtV: crF.moneyK, posLabel: "Balance reduced", negLabel: "Balance increased" },
  ];
  const ins = [], pw = crPrevWord(R);
  if (red != null) ins.push(twoSnapshots ? `The AR inventory ${red >= 0 ? "came down" : "went up"} by ${crF.pct(Math.abs(red), 0)} against the ${pw}: ${crF.money(amtPrev, 0)} (${crF.int(nPrev)} claims) to ${crF.money(amtCur, 0)} (${crF.int(nCur)} claims).`
    : `Of the ${crF.money(amtPrev, 0)} received (${crF.int(nPrev)} claims), ${crF.money(amtPrev - amtCur, 0)} has been closed and ${crF.money(amtCur, 0)} across ${crF.int(nCur)} claims is still open, a ${crF.pct(Math.max(0, red), 0)} reduction.`);
  const cnt = crDelta(nCur, nPrev); if (cnt && cnt.diff && twoSnapshots) ins.push(`Claim count ${cnt.diff >= 0 ? "rose" : "fell"} from ${crF.int(nPrev)} to ${crF.int(nCur)} (${crPl(Math.abs(cnt.diff), "claim")} ${cnt.diff > 0 ? "more" : "fewer"}), so the average open claim is now ${crF.money(nCur ? amtCur / nCur : 0, 0)}${nPrev ? ` against ${crF.money(amtPrev / nPrev, 0)} before` : ""}.`);
  const cntOf = (k) => (redCnt.find((x) => x.key === k) || {}).value || 0;
  const bestRed = redAmt.filter((x) => x.value > 0).sort((a, b) => b.value - a.value)[0]; if (bestRed) ins.push(`The largest reduction came from the ${bestRed.label} bucket: ${crF.money(bestRed.value, 0)}${cntOf(bestRed.key) > 0 ? " (" + crPl(cntOf(bestRed.key), "claim") + ")" : ""} cleared.`);
  const worst = redAmt.filter((x) => x.value < 0).sort((a, b) => a.value - b.value)[0]; if (worst) ins.push(`The ${worst.label} bucket grew by ${crF.money(-worst.value, 0)}${cntOf(worst.key) < 0 ? " (" + crPl(-cntOf(worst.key), "claim") + ")" : ""}; these need attention before they age further.`);
  const top = bC.slice().sort((a, b) => b.value - a.value)[0]; if (top) { const pt = bP.find((x) => x.key === top.key); ins.push(`${top.label} is the heaviest open bucket at ${crF.money(top.value, 0)}, ${crF.pct(top.share, 0)} of the open balance${pt ? ` (${crF.pct(pt.share, 0)} at ${prevLabel.replace(/^AR · /, "")})` : ""}.`); }
  const old = bC.filter((x) => x.lo >= 121), oldP = bP.filter((x) => x.lo >= 121); if (old.length) ins.push(`${crF.pct(crSum(old, (x) => x.share), 0)} of the open balance is older than 120 days${oldP.length ? `, compared with ${crF.pct(crSum(oldP, (x) => x.share), 0)} before` : ""}; timely filing and appeal limits make this the priority slice.`);
  const headline = red == null ? "Inventory analysis" : twoSnapshots ? `AR ${red >= 0 ? "came down" : "went up"} ${crF.pct(Math.abs(red), 0)} in ${R.periodName}` : `${crF.pct(Math.max(0, red), 0)} of the inventory received is cleared`;
  return { title: "Inventory analysis", headline, sub: twoSnapshots ? `Open AR at ${prevLabel.replace(/^AR · /, "")} against ${curLabel.replace(/^AR · /, "")}, by age of claim` : `Inventory on file · ${R.client}`,
    note: rebuilt ? `The ${crF.date(crD(rebuilt))} inventory is rebuilt from the claims' history (Brahmastra keeps a month-end snapshot from now on).` : "",
    watermark: "INVENTORY", kpis, cards, insights: ins, slicers: ["payerKey", "bucket", "purviewStatus", "action"].filter((f) => curSet.some((r) => r[f])), claims: crClaims(ds, ds && ds.cells ? [] : curSet, "inventory"), unfiltered: true };
}
function crBuildInventory2(c) {
  const R = c.R, { ds, prevSet, curSet, twoSnapshots, curLabel } = crInvSets(c);
  if (!ds) return null;
  const amtCur = crSum(curSet, (r) => r.amount);
  const payerItems = crEmph80(crAgg(curSet, "payerKey", ds, { measure: "amount" })); crMarkSel(payerItems, c.sel.payerKey);
  const n80 = payerItems.filter((x) => x.emph).length;
  const statusField = curSet.some((r) => r.purviewStatus) ? "purviewStatus" : curSet.some((r) => r.pmsStatus) ? "pmsStatus" : "status";
  const stAll = crAgg(curSet, statusField, ds, { measure: "amount" }), stItems = crFold(stAll, 6); crMarkSel(stItems, c.sel[statusField]);
  const actItems = crAgg(curSet, "action", ds, { measure: "amount" }); crMarkSel(actItems, c.sel.action);
  const kpis = [crKpi(`Open balance`, crF.money(amtCur, 0), { sub: `${crF.int(crN(curSet))} claims`, accent: true }), crKpi("Payers", crF.int(payerItems.length), { sub: payerItems.length ? `${n80} hold 80% of the balance` : "" })];
  if (payerItems[0]) kpis.push(crKpi("Largest payer", crF.pct(payerItems[0].share, 0), { sub: payerItems[0].label }));
  if (stAll[0]) kpis.push(crKpi("Top status", crF.pct(stAll[0].share, 0), { sub: stAll[0].label }));
  const cards = [
    { id: "inv2.payer", title: "Insurance wise Pareto", sub: "Payers holding the top 80% of the balance are highlighted", cols: 6, type: "hbar", dim: "payerKey", dimLabel: "Payer", items: payerItems, measureLabel: "Amount", fmtV: crF.moneyK, fmtT: crF.money, secondary: { key: "count", label: "Claims", fmt: crF.int }, emphasis: true, maxRows: 7,
      callout: payerItems.length ? `<b>${n80} of ${payerItems.length} payers</b> hold 80% of the balance: ${crEsc(crListNames(payerItems.filter((x) => x.emph)))}.` : "" },
    { id: "inv2.status", title: "Inventory status mix", sub: crDimLabel(ds, statusField), cols: 6, type: "donut", dim: statusField, items: stItems, measureLabel: "Amount", fmtV: crF.moneyK, fmtT: crF.money, centerValue: crF.moneyK(amtCur), centerLabel: "open" },
  ];
  if (actItems.length > 1) cards.push({ id: "inv2.action", title: "Action wise breakdown", sub: "Balance by action taken", cols: 12, type: "hbar", dim: "action", dimLabel: "Action", items: actItems, measureLabel: "Amount", fmtV: crF.moneyK, fmtT: crF.money, secondary: { key: "count", label: "Claims", fmt: crF.int }, maxRows: 5 });
  const ins = [];
  if (payerItems.length) ins.push(`${crListNames(payerItems.filter((x) => x.emph))} ${n80 === 1 ? "holds" : "hold"} 80% of the open balance (${crF.money(crSum(payerItems.filter((x) => x.emph), (x) => x.amount), 0)}), so payer level follow up with ${n80 === 1 ? "this payer" : "these payers"} moves most of the money.`);
  if (payerItems[0]) ins.push(`${payerItems[0].label} alone carries ${crF.pct(payerItems[0].share, 0)} (${crF.int(payerItems[0].count)} claims, ${crF.money(payerItems[0].amount, 0)})${payerItems[1] ? `; ${payerItems[1].label} follows with ${crF.pct(payerItems[1].share, 0)}` : ""}.`);
  if (stAll.length) ins.push(`Status mix: ${stAll.slice(0, 4).map((s) => `${s.label} ${crF.pct(s.share, 0)}`).join(", ")}.`);
  const denied = stAll.find((s) => /deni/.test(s.key)); if (denied) ins.push(`${crF.money(denied.amount, 0)} (${crF.int(denied.count)} claims) sits in denied status and needs appeals or corrected claims before it can be collected.`);
  if (actItems[0]) ins.push(`The most common action is ${actItems[0].label} (${crF.pct(actItems[0].share, 0)} of the balance)${actItems[1] ? `, then ${actItems[1].label} (${crF.pct(actItems[1].share, 0)})` : ""}.`);
  if (twoSnapshots) { ins.push(...crMovers(R, curSet, prevSet, "payerKey", ds, { measure: "amount", noun: "payer", shareOf: "inventory balance" })); ins.push(...crMovers(R, curSet, prevSet, statusField, ds, { measure: "amount", noun: "status", share: false, newItems: true })); }
  const headline = payerItems[0] ? `${payerItems[0].label} holds ${crF.pct(payerItems[0].share, 0)} of the open balance` : "Inventory breakdown";
  return { title: "Inventory breakdown", headline, sub: `Payers, status and actions · ${curLabel.replace(/^AR · /, "open AR at ")}`, watermark: "PAYERS", kpis, cards, insights: ins,
    slicers: ["payerKey", "bucket", statusField, "action"].filter((f) => curSet.some((r) => r[f])), claims: crClaims(ds, ds.cells ? [] : curSet, "inventory"), unfiltered: true };
}
function crBuildSubmission(c) {
  const R = c.R, ds = c.ds("submission"); if (!ds) return null;
  const all = c.rows("submission", null), rowsAll = c.rowsAll("submission"), only = (r) => crSubState(r) === "submitted";
  const submitted = all.filter(only), notSub = all.filter((r) => crSubState(r) === "not"), dup = all.filter((r) => crSubState(r) === "duplicate");
  const prevSub = c.hasPrev("submission") ? c.prev("submission").filter(only) : null;
  const amt = crSum(submitted, (r) => r.amount), wd = crWorkingDaysIn(c.range, submitted, ds.dateField);
  const dosList = submitted.map((r) => r.dos).filter(Boolean).sort((a, b) => a - b), oldest = dosList[0] || null, newest = dosList[dosList.length - 1] || null;
  const refDate = c.range.end;
  const kpis = [
    crKpi("Claims submitted", crF.int(submitted.length), { delta: crDelta(submitted.length, prevSub ? prevSub.length : null), fmt: crF.int, accent: true }),
    crKpi("Charges submitted", crF.moneyK(amt), { sub: crMoneySub(amt), delta: crDelta(amt, prevSub ? crSum(prevSub, (r) => r.amount) : null), fmt: crF.moneyK }),
    crKpi("Per working day", wd ? crF.int(submitted.length / wd) : "–", { sub: wd ? `${wd} working days` : "" }),
    crKpi("Average charge", submitted.length ? crF.money(amt / submitted.length, 0) : "–", { sub: "per claim" }),
    crKpi("Oldest DOS", oldest ? crF.date(oldest) : "–", { sub: oldest ? `${crDaysBetween(oldest, refDate) - 1} days old at period end` : "", small: true }),
    crKpi("Newest DOS", newest ? crF.date(newest) : "–", { sub: newest ? `${crDaysBetween(newest, refDate) - 1} days old at period end` : "", small: true }),
  ];
  const cards = [];
  crAddCard(cards, crCardBar(c, "payerKey", "Insurance wise breakdown", { role: "submission", cols: 4, measure: "count", prev: true, maxRows: 8, rowFilter: only, sub: "Submitted claims" }), 1);
  const stItems = crAgg(all, "status", ds); crMarkSel(stItems, c.sel.status);
  if (stItems.length > 1) cards.push({ id: "sub.status", title: "Action items", sub: "Submission status", cols: 4, type: "col", dim: "status", dimLabel: "Status", items: stItems.slice(0, 8), measureLabel: "Claims", fmtV: crF.int, fmtT: crF.int, secondary: { key: "amount", label: "Charges", fmt: crF.money } });
  crAddCard(cards, crCardBar(c, "carrier", "Submission mode", { role: "submission", cols: 4, measure: "amount", rowFilter: only, sub: "Charges submitted" }));
  if (notSub.length) { const reasons = crAgg(notSub, "comment", { labels: { comment: {} } }).slice(0, 5); cards.push({ id: "sub.notsub", title: "Not submitted: reasons", sub: `${crPl(notSub.length, "claim")} could not be submitted`, cols: 12, type: "table", rows: reasons.map((x) => [crTrunc(x.key || "No reason given", 120), crF.int(x.count), crF.money(x.amount, 0)]), head: ["Reason", "Claims", "Charges"] }); }
  const payers = crAgg(submitted, "payerKey", ds), top = payers[0], ins = [], pw = crPrevWord(R);
  ins.push(`${crF.int(submitted.length)} claims worth ${crF.money(amt, 0)} were submitted in ${crRangeLabel(c.range)}${wd ? `, an average of ${crF.int(submitted.length / wd)} claims per working day` : ""}${submitted.length ? ` and ${crF.money(amt / submitted.length, 0)} per claim` : ""}.`);
  if (top) ins.push(`${top.label} received ${crF.pct(top.share, 0)} of submissions (${crF.int(top.count)} claims)${payers[1] ? `, followed by ${payers[1].label} at ${crF.pct(payers[1].share, 0)}` : ""}.`);
  if (oldest && newest) { const lag = submitted.filter((r) => r.dos && crDaysBetween(r.dos, refDate) - 1 > 45).length; ins.push(`Service dates range from ${crF.date(oldest)} to ${crF.date(newest)}; ${lag ? `${crF.int(lag)} claims (${crF.pct(lag / submitted.length, 0)}) were over 45 days old when billed, which eats into filing limits` : "everything was billed within 45 days of service"}.`); }
  if (prevSub) { const h = crHeadline(R, "Submissions", submitted.length, prevSub.length, crF.int, { plural: true }); if (h) ins.push(h + (prevSub.length ? ` Charges went from ${crF.money(crSum(prevSub, (r) => r.amount), 0)} to ${crF.money(amt, 0)}.` : "")); ins.push(...crMovers(R, submitted, prevSub, "payerKey", ds, { noun: "payer", shareOf: "submissions" })); }
  if (notSub.length) { const r0 = crAgg(notSub, "comment", { labels: { comment: {} } })[0]; ins.push(`${crF.int(notSub.length)} claims (${crF.money(crSum(notSub, (r) => r.amount), 0)}) are still not submitted${r0 && r0.key ? `; the main blocker is "${crTrunc(r0.key, 90)}"` : ""}.`); }
  if (dup.length) ins.push(`${crF.int(dup.length)} duplicate claims were identified and held back from submission.`);
  return { title: "Submission", headline: `${crF.int(submitted.length)} claims submitted, ${crF.money(amt, 0)} billed`, sub: `${R.client} · ${crRangeLabel(c.range)}`, watermark: "SUBMISSION", kpis, cards, insights: ins,
    slicers: ["payerKey", "status", "workBy"].filter((f) => rowsAll.some((r) => r[f])), claims: crClaims(ds, all, "submission") };
}
function crBuildRejection(c) {
  const R = c.R, ds = c.ds("rejection"); if (!ds) return null;
  const all = c.rows("rejection", null), subRows = c.ds("submission") ? c.rowsAll("submission").filter((r) => crSubState(r) === "submitted") : [];
  const rate = subRows.length ? all.length / subRows.length : (c.ds("worked") ? all.length / Math.max(1, c.rowsAll("worked").length) : null);
  const prev = c.hasPrev("rejection") ? c.prev("rejection") : null;
  const kpis = [
    crKpi("Rejected claims", crF.int(all.length), { delta: crDelta(all.length, prev ? prev.length : null), upGood: false, fmt: crF.int, accent: true }),
    crKpi("Rejection rate", rate == null ? "–" : crF.pct(rate, 1), { sub: subRows.length ? `of ${crF.int(subRows.length)} submitted` : c.ds("worked") ? "of worked claims" : "", upGood: false }),
    crKpi("Rejected amount", crF.moneyK(crSum(all, (r) => r.amount)), { sub: crMoneySub(crSum(all, (r) => r.amount)) }),
  ];
  const cards = [];
  crAddCard(cards, crCardBar(c, "payerKey", "Insurance wise breakdown", { role: "rejection", cols: 6, prev: true, maxRows: 10 }), 1);
  crAddCard(cards, crCardBar(c, "status", "Rejection reasons", { role: "rejection", cols: 6, emph: true, maxRows: 10, sub: "Top 80% of rejections highlighted" }), 1);
  crAddCard(cards, crCardBar(c, "action", "Action wise breakdown", { role: "rejection", cols: 12, maxRows: 6 }));
  const ins = [], reasons = crAgg(all, "status", ds), acts = crAgg(all, "action", ds);
  ins.push(`${crF.int(all.length)} claims were rejected in ${crRangeLabel(c.range)}${rate != null ? `, a rejection rate of ${crF.pct(rate, 1)}` : ""}.`);
  if (reasons[0]) ins.push(`The leading rejection reason is ${reasons[0].label} (${crF.pct(reasons[0].share, 0)})${reasons[1] ? `, followed by ${reasons[1].label} (${crF.pct(reasons[1].share, 0)})` : ""}.`);
  if (ds.dateField) { const byDay = new Map(); for (const r of all) { const d = r[ds.dateField]; if (!d) continue; const k = crF.iso(d); let e = byDay.get(k); if (!e) { e = { d, rows: [] }; byDay.set(k, e); } e.rows.push(r); }
    const days = [...byDay.values()].sort((a, b) => b.rows.length - a.rows.length || a.d - b.d).slice(0, 3);
    if (days.length) ins.push(`Most rejections came on ${days.map((e) => `${crF.date(e.d)} (${crF.int(e.rows.length)}: ${crAgg(e.rows, "status", ds).slice(0, 2).map((x) => `${x.label} ${crF.int(x.count)}`).join(", ")})`).join("; ")}.`); }
  const resub = acts.find((x) => /rebill|resubmit|corrected|sent/.test(x.key)); if (resub) ins.push(`${crF.pct(resub.share, 0)} of rejected claims were already corrected and resubmitted (${resub.label}).`);
  if (prev) { const h = crHeadline(R, "Rejections", all.length, prev.length, crF.int, { plural: true }); if (h) ins.push(h); ins.push(...crMovers(R, all, prev, "status", ds, { noun: "reason", share: false, newItems: true })); ins.push(...crMovers(R, all, prev, "payerKey", ds, { noun: "payer", shareOf: "rejections" })); }
  return { title: "Rejections", headline: `${crF.int(all.length)} claims rejected${rate != null ? `, ${crF.pct(rate, 1)} of submissions` : ""}`, sub: `${R.client} · ${crRangeLabel(c.range)}${ds.derivedFrom ? " · from the AR work entries" : ""}`, watermark: "REJECTION", kpis, cards, insights: ins,
    slicers: ["payerKey", "status", "action", "workBy"].filter((f) => all.some((r) => r[f])), claims: crClaims(ds, all, "rejection") };
}
function crBuildPayment(c) {
  const R = c.R, ds = c.ds("payment"); if (!ds) return null;
  const all = c.rows("payment", null), posted = all.filter((r) => /posted/.test(r.status || "")), paidOf = (r) => (r.paid != null ? r.paid : r.amount) || 0;
  const amt = crSum(posted, paidOf), charged = crSum(posted, (r) => r.charge || 0), checks = crUniq(posted.map((r) => r.checkNo).filter(Boolean)).length;
  const prev = c.hasPrev("payment") ? c.prev("payment").filter((r) => /posted/.test(r.status || "")) : null;
  const kpis = [
    crKpi("Total posted", crF.moneyK(amt), { sub: crMoneySub(amt), delta: crDelta(amt, prev ? crSum(prev, paidOf) : null), fmt: crF.moneyK, accent: true }),
    crKpi("Payment lines", crF.int(posted.length), { delta: crDelta(posted.length, prev ? prev.length : null), fmt: crF.int }),
    crKpi("Checks / EFTs", checks ? crF.int(checks) : "–"),
    crKpi("Average per line", posted.length ? crF.money(amt / posted.length, 0) : "–"),
  ];
  if (charged) kpis.push(crKpi("Paid vs charged", crF.pct(amt / charged, 0), { sub: `${crF.money(charged, 0)} charged` }));
  const cards = [];
  crAddCard(cards, crCardBar(c, "payerKey", "Insurance wise breakdown", { role: "payment", cols: 5, measure: "amount", prev: true, maxRows: 9 }), 1);
  crAddCard(cards, crCardBar(c, "week", "Week wise posting", { role: "payment", cols: 4, measure: "amount", type: "col", order: "week" }));
  const s = crCardBar(c, "status", "Payment status", { role: "payment", cols: 3, measure: "count", type: "donut", maxRows: 6 }); if (s && s.items && s.items.length > 1) { s.items = crFold(s.items, 6); s.centerValue = crF.int(all.length); s.centerLabel = "lines"; cards.push(s); }
  const ins = [], payers = crAgg(posted, "payerKey", ds, { measure: "amount" });
  ins.push(`${crF.money(amt, 0)} was posted in ${crRangeLabel(c.range)} across ${crF.int(posted.length)} payment lines${checks ? ` and ${crF.int(checks)} checks or EFTs` : ""}.`);
  if (payers[0]) ins.push(`${payers[0].label} paid ${crF.pct(payers[0].share, 0)} of the total (${crF.money(payers[0].amount, 0)})${payers[1] ? `; ${payers[1].label} followed with ${crF.pct(payers[1].share, 0)}` : ""}.`);
  if (charged) ins.push(`Posted payments equal ${crF.pct(amt / charged, 0)} of the charges on those claims.`);
  const wk = crAgg(posted, "week", ds, { measure: "amount", order: "week" }); if (wk.length > 1) { const best = wk.slice().sort((a, b) => b.value - a.value)[0]; ins.push(`${best.label} was the strongest posting week with ${crF.money(best.value, 0)} (${crF.pct(best.share, 0)} of the ${R.range.kind === "week" ? "period" : "month"}).`); }
  const pending = all.filter((r) => !/posted/.test(r.status || "")); if (pending.length) ins.push(`${crF.int(pending.length)} lines (${crF.pct(pending.length / Math.max(1, all.length), 0)}) are not posted yet; closing them completes the posting cycle.`);
  if (prev) { const h = crHeadline(R, "Collections", amt, crSum(prev, paidOf), (v) => crF.money(v, 0), { up: "increased", down: "decreased", plural: true }); if (h) ins.push(h); ins.push(...crMovers(R, posted, prev, "payerKey", ds, { measure: "amount", noun: "payer", shareOf: "payments" })); }
  const d = prev ? crDelta(amt, crSum(prev, paidOf)) : null;
  return { title: "Payment posting", headline: d && d.pct != null && d.diff ? `Collections ${d.diff > 0 ? "rose" : "fell"} ${crF.pct(Math.abs(d.pct), 0)} to ${crF.money(amt, 0)}` : `${crF.money(amt, 0)} posted in ${R.periodName}`,
    sub: `${R.client} · ${crRangeLabel(c.range)}`, watermark: "POSTING", kpis, cards, insights: ins, slicers: ["payerKey", "status", "week", "workBy"].filter((f) => all.some((r) => r[f])), claims: crClaims(ds, all, "payment") };
}
function crBuildAR(c) {
  const R = c.R, ds = c.ds("worked"); if (!ds) return null;
  const all = c.rows("worked", null), prev = c.hasPrev("worked") ? c.prev("worked") : null;
  const amt = crSum(all, (r) => r.amount), paid = all.filter(crIsPaid), den = all.filter(crIsDenied), wd = crWorkingDaysIn(c.range, all, ds.dateField);
  const kpis = [
    crKpi("Claims worked", crF.int(all.length), { delta: crDelta(all.length, prev ? prev.length : null), fmt: crF.int, accent: true }),
    crKpi("Amount worked", crF.moneyK(amt), { sub: crMoneySub(amt), delta: crDelta(amt, prev ? crSum(prev, (r) => r.amount) : null), fmt: crF.moneyK }),
    crKpi("Confirmed paid", crF.pct(crPctOf(paid.length, all.length), 0), { sub: `${crF.int(paid.length)} claims`, delta: prev ? crPtDelta(crPctOf(paid.length, all.length), crPctOf(prev.filter(crIsPaid).length, prev.length)) : null }),
    crKpi("Denied", crF.pct(crPctOf(den.length, all.length), 0), { sub: `${crF.int(den.length)} claims`, upGood: false, delta: prev ? crPtDelta(crPctOf(den.length, all.length), crPctOf(prev.filter(crIsDenied).length, prev.length)) : null }),
  ];
  if (wd) kpis.push(crKpi("Per working day", crF.int(all.length / wd), { sub: `${wd} working days` }));
  const cards = [];
  crAddCard(cards, crCardBar(c, "bucket", "Aging wise production", { role: "worked", cols: 6, type: "col", prev: true }), 1);
  crAddCard(cards, crCardBar(c, "purviewStatus", "Status wise breakdown", { role: "worked", cols: 6, measure: "amount", maxRows: 8 }), 1);
  crAddCard(cards, crCardBar(c, "action", "Action required", { role: "worked", cols: 6, measure: "amount", maxRows: 8 }), 1);
  crAddCard(cards, crCardBar(c, "payerKey", "Insurance wise breakdown", { role: "worked", cols: 6, measure: "amount", prev: true, maxRows: 8 }), 1);
  const ins = [], pw = crPrevWord(R);
  ins.push(`${crF.int(all.length)} claims worth ${crF.money(amt, 0)} were worked in ${crRangeLabel(c.range)}${wd ? ` (${crF.int(all.length / wd)} per working day)` : ""}.`);
  const outcomes = crAgg(all, "purviewStatus", ds); if (outcomes.length) ins.push(`Outcomes: ${outcomes.slice(0, 4).map((o) => `${o.label} ${crF.pct(o.share, 0)}`).join(", ")}.`);
  const buckets = crAgg(all, "bucket", ds, { measure: "amount" }), old = buckets.filter((x) => x.lo >= 181); if (old.length) ins.push(`${crF.pct(crSum(old, (x) => x.share), 0)} of the amount worked sits in claims older than 180 days; timely filing and appeal limits are the main risk there.`);
  const acts = crAgg(all, "action", ds); if (acts[0]) ins.push(`The most common action was ${acts[0].label} (${crF.pct(acts[0].share, 0)})${acts[1] ? `, then ${acts[1].label} (${crF.pct(acts[1].share, 0)})` : ""}.`);
  const sts = crAgg(all, "status", ds, { measure: "amount" }); if (sts[0]) ins.push(`By status, ${sts[0].label} carries the largest amount worked (${crF.money(sts[0].amount, 0)}, ${crF.pct(sts[0].share, 0)}).`);
  if (prev) {
    const h = crHeadline(R, "Production", all.length, prev.length, crF.int, { up: "is up", down: "is down" }); if (h) ins.push(h);
    const pPaid = crPctOf(prev.filter(crIsPaid).length, prev.length), cPaid = crPctOf(paid.length, all.length), pDen = crPctOf(prev.filter(crIsDenied).length, prev.length), cDen = crPctOf(den.length, all.length);
    if (pPaid != null && cPaid != null) ins.push(`Confirmed paid moved from ${crF.pct(pPaid, 0)} to ${crF.pct(cPaid, 0)} of claims worked, and denied from ${crF.pct(pDen, 0)} to ${crF.pct(cDen, 0)}.`);
    ins.push(...crMovers(R, all, prev, "bucket", ds, { noun: "aging bucket", share: false })); ins.push(...crMovers(R, all, prev, "payerKey", ds, { measure: "amount", noun: "payer", shareOf: "amount worked" }));
  }
  return { title: "AR production", headline: `${crF.int(all.length)} claims worked, ${crF.pct(crPctOf(paid.length, all.length), 0)} confirmed paid`, sub: `${R.client} · ${crRangeLabel(c.range)}`, watermark: "AR", kpis, cards, insights: ins,
    slicers: ["payerKey", "bucket", "purviewStatus", "action", "workBy"].filter((f) => all.some((r) => r[f])), claims: crClaims(ds, all, "worked") };
}
const crPtDelta = (cur, prev) => (cur == null || prev == null ? null : { cur, prev, diff: cur - prev, pct: null, pts: true });
function crTopDenials(reasons) {
  // the 80% rule with a sanity cap: more than 6 reasons to reach 80% shows the top 5, fewer than 3 shows the top 3
  const n80 = reasons.filter((x) => x.emph).length;
  if (reasons.length <= 3) return { rows: reasons.slice(), basis: reasons.length ? `all ${reasons.length} denial reason${reasons.length === 1 ? "" : "s"}` : "no denials", label: `Top ${reasons.length}` };
  if (n80 >= 3 && n80 <= 6) return { rows: reasons.filter((x) => x.emph), basis: `the ${n80} reasons that make up 80% of denied dollars`, label: "Top 80%" };
  if (n80 < 3) return { rows: reasons.slice(0, 3), basis: `the top 3 denial reasons (80% of denied dollars is reached with ${n80 === 1 ? "one reason" : "two reasons"}, so the next ones are included)`, label: "Top 3" };
  return { rows: reasons.slice(0, 5), basis: `the top 5 denial reasons (reaching 80% of denied dollars would need ${n80} reasons)`, label: "Top 5" };
}
function crBuildDenials(c) {
  const R = c.R, ds = c.ds("denial"); if (!ds) return null;
  const all = c.rows("denial", null), workedN = c.ds("worked") ? c.rowsAll("worked").length : null, prev = c.hasPrev("denial") ? c.prev("denial") : null;
  const amt = crSum(all, (r) => r.amount), rate = workedN ? all.length / workedN : null;
  const kpis = [
    crKpi("Denied claims", crF.int(all.length), { delta: crDelta(all.length, prev ? prev.length : null), upGood: false, fmt: crF.int, accent: true }),
    crKpi("Denied amount", crF.moneyK(amt), { sub: crMoneySub(amt), delta: crDelta(amt, prev ? crSum(prev, (r) => r.amount) : null), upGood: false, fmt: crF.moneyK }),
    crKpi("Denial rate", rate == null ? "–" : crF.pct(rate, 1), { sub: workedN ? `of ${crF.int(workedN)} claims worked` : "", upGood: false, delta: prev && c.hasPrev("worked") && c.prev("worked").length ? crPtDelta(rate, prev.length / c.prev("worked").length) : null }),
  ];
  const reasons = crEmph80(crAgg(all, "status", ds, { measure: "amount" })); crMarkSel(reasons, c.sel.status);
  const tops = crTopDenials(reasons), cards = [];
  cards.push({ id: "den.reason", title: "Denial reasons", sub: "Top 80% of denied dollars highlighted", cols: 6, type: "hbar", dim: "status", dimLabel: "Reason", items: reasons, measureLabel: "Amount", fmtV: crF.moneyK, fmtT: crF.money, secondary: { key: "count", label: "Claims", fmt: crF.int }, emphasis: true, maxRows: 9,
    callout: reasons.length ? `<b>${crEsc(tops.label)} denials</b>: ${crEsc(crListNames(tops.rows, 5))}.` : "" });
  crAddCard(cards, crCardBar(c, "payerKey", "Payer wise breakdown", { role: "denial", cols: 6, measure: "amount", prev: true, maxRows: 9 }), 1);
  crAddCard(cards, crCardBar(c, "action", "Action taken on denials", { role: "denial", cols: 12, measure: "amount", maxRows: 6 }));
  const ins = [];
  ins.push(`${crF.int(all.length)} claims worth ${crF.money(amt, 0)} were denied in ${crRangeLabel(c.range)}${rate != null ? `, ${crF.pct(rate, 1)} of the claims worked` : ""}.`);
  if (reasons[0]) ins.push(`${reasons[0].label} is the biggest denial reason at ${crF.money(reasons[0].amount, 0)} (${crF.pct(reasons[0].share, 0)} of denied dollars, ${crF.int(reasons[0].count)} claims).`);
  if (tops.rows.length) ins.push(`${tops.label === "Top 80%" ? `${tops.rows.length} reasons explain 80% of the denied amount` : `The ${tops.label.toLowerCase()} reasons cover ${crF.pct(crSum(tops.rows, (x) => x.share), 0)} of the denied amount`}: ${crListNames(tops.rows, 5)}. The RCA page covers each of them.`);
  const payers = crAgg(all, "payerKey", ds, { measure: "amount" }); if (payers[0]) ins.push(`${payers[0].label} accounts for ${crF.pct(payers[0].share, 0)} of denied dollars.`);
  const acts = crAgg(all, "action", ds), appeal = acts.filter((x) => /appeal|recon|reprocess|corrected|rebill/.test(x.key)); if (appeal.length) ins.push(`${crF.pct(crSum(appeal, (x) => x.share), 0)} of denials have already been challenged (${crListNames(appeal, 3)}).`);
  const adj = acts.filter((x) => /adjust|write ?off/.test(x.key)); if (adj.length) ins.push(`${crF.pct(crSum(adj, (x) => x.share), 0)} were sent for adjustment as non collectible.`);
  if (prev) { const h = crHeadline(R, "Denied claims", all.length, prev.length, crF.int, { plural: true }); if (h) ins.push(h + ` Denied dollars went from ${crF.money(crSum(prev, (r) => r.amount), 0)} to ${crF.money(amt, 0)}.`);
    ins.push(...crMovers(R, all, prev, "status", ds, { measure: "amount", noun: "reason", share: false, newItems: true })); ins.push(...crMovers(R, all, prev, "payerKey", ds, { measure: "amount", noun: "payer", shareOf: "denied dollars" })); }
  return { title: "Denials", headline: `${crF.int(all.length)} claims denied, ${crF.money(amt, 0)}${rate != null ? ` (${crF.pct(rate, 1)} of claims worked)` : ""}`, sub: `${R.client} · ${crRangeLabel(c.range)} · from the AR work entries`, watermark: "DENIALS", kpis, cards, insights: ins,
    slicers: ["payerKey", "status", "action", "bucket", "workBy"].filter((f) => all.some((r) => r[f])), claims: crClaims(ds, all, "denial") };
}
function crBuildRCA(c) {
  const R = c.R, ds = c.ds("denial"); if (!ds) return null;
  const all = c.rows("denial", null), prev = c.hasPrev("denial") ? c.prev("denial") : null;
  const reasons = crEmph80(crAgg(all, "status", ds, { measure: "amount" })), tops = crTopDenials(reasons), prevAgg = prev ? crAgg(prev, "status", ds, { measure: "amount" }) : null;
  const rows = tops.rows.map((x) => { const sub = all.filter((r) => String(r.status || "") === x.key); const payers = crAgg(sub, "payerKey", ds).slice(0, 3); const p = prevAgg ? prevAgg.find((y) => y.key === x.key) : null;
    return { key: x.key, reason: x.label, count: x.count, amount: x.amount, share: x.share, prevCount: p ? p.count : (prevAgg ? 0 : null), prevAmount: p ? p.amount : (prevAgg ? 0 : null), payers: payers.slice(0, 2).map((y) => `${y.label} ${crF.pct(y.share, 0)}`).join(", "), actions: crAgg(sub, "action", ds).slice(0, 1).map((y) => y.label).join(", ") }; });
  const covered = crSum(tops.rows, (x) => x.share), ins = [];
  ins.push(`This table covers ${tops.basis}${tops.rows.length ? `, ${crF.pct(covered, 0)} of the ${crF.money(crSum(all, (r) => r.amount), 0)} denied in ${crRangeLabel(c.range)}` : ""}. Claim counts, amounts and payer mix come from the data; the Issue / RCA and Mitigation plan are written by our team.`);
  if (prev) for (const r of rows) { if (r.prevCount == null) continue; const d = crDelta(r.count, r.prevCount); if (!d) continue; if (r.prevCount === 0) ins.push(`${r.reason} is new this period (${crF.int(r.count)} claims, ${crF.money(r.amount, 0)}).`); else if (Math.abs(d.pct) >= 0.25) ins.push(`${r.reason} ${d.diff > 0 ? "rose" : "fell"} ${crF.pct(Math.abs(d.pct), 0)} against the ${crPrevWord(R)} (${crF.int(r.prevCount)} to ${crF.int(r.count)} claims).`); }
  return { title: "Top denials: RCA & mitigation plan", headline: tops.rows.length ? `${tops.rows.length === 1 ? "One reason makes" : crF.int(tops.rows.length) + " reasons make"} up ${crF.pct(covered, 0)} of denied dollars` : "No denials in this period",
    sub: `${R.client} · ${crRangeLabel(c.range)} · ${tops.rows.length ? tops.label + " denials by denied dollars" : ""}`, watermark: "RCA", kpis: [], cards: [{ id: "rca.table", title: "", cols: 12, type: "rca", rows, hasPrev: !!prev }], insights: ins, slicers: [] };
}
function crBuildCA(c) {
  const R = c.R, ds = c.ds("clientAssistance"); if (!ds) return null;
  const all = c.rows("clientAssistance", null), prev = c.hasPrev("clientAssistance") ? c.prev("clientAssistance") : null, amt = crSum(all, (r) => r.amount);
  const kpis = [
    crKpi("Claims needing the client", crF.int(all.length), { delta: crDelta(all.length, prev ? prev.length : null), upGood: false, fmt: crF.int, accent: true }),
    crKpi("Amount on hold", crF.moneyK(amt), { sub: crMoneySub(amt), delta: crDelta(amt, prev ? crSum(prev, (r) => r.amount) : null), upGood: false, fmt: crF.moneyK }),
  ];
  const old = all.filter((r) => r.bucketLo >= 121); if (all.length) kpis.push(crKpi("Older than 120 days", crF.pct(old.length / all.length, 0), { sub: `${crF.int(old.length)} claims at filing risk`, upGood: false }));
  const open = all.filter((r) => r.open === true); if (open.length) kpis.push(crKpi("Still open", crF.int(open.length), { sub: "requests waiting on you" }));
  const cards = [];
  crAddCard(cards, crCardBar(c, "status", "What is needed", { role: "clientAssistance", cols: 6, measure: "amount", maxRows: 9 }), 1);
  crAddCard(cards, crCardBar(c, "action", "Where each request stands", { role: "clientAssistance", cols: 6, measure: "count" }));
  crAddCard(cards, crCardBar(c, "payerKey", "Payer wise breakdown", { role: "clientAssistance", cols: 6, measure: "amount", type: "col" }), 1);
  crAddCard(cards, crCardBar(c, "bucket", "Aging of pending items", { role: "clientAssistance", cols: 6, type: "col" }), 1);
  const ins = [];
  ins.push(`${crF.int(all.length)} claims worth ${crF.money(amt, 0)} needed input from the client in ${crRangeLabel(c.range)}${open.length ? `; ${crF.int(open.length)} are still waiting` : ""}.`);
  const st = crAgg(all, "status", ds, { measure: "amount" }); if (st[0]) ins.push(`The largest group is ${st[0].label}: ${crF.int(st[0].count)} claims, ${crF.money(st[0].amount, 0)}.`);
  const act = crAgg(all, "action", ds); if (act[0]) ins.push(`Where they stand: ${act.slice(0, 3).map((x) => `${x.label} (${crF.int(x.count)})`).join(", ")}.`);
  if (old.length) ins.push(`${crF.int(old.length)} of these claims are already past 120 days from the date of service; a response this ${R.range.kind === "week" ? "week" : "month"} avoids timely filing and appeal limit losses.`);
  if (prev) { const h = crHeadline(R, "Client assistance items", all.length, prev.length, crF.int, { plural: true }); if (h) ins.push(h); ins.push(...crMovers(R, all, prev, "status", ds, { noun: "status", share: false, newItems: true })); }
  return { title: "Client assistance", headline: `${crF.int(all.length)} claims need the client, ${crF.money(amt, 0)} on hold`, sub: `${R.client} · ${crRangeLabel(c.range)}`, watermark: "CLIENT", kpis, cards, insights: ins,
    slicers: ["payerKey", "status", "action", "bucket", "dept"].filter((f) => all.some((r) => r[f])), claims: crClaims(ds, all, "clientAssistance") };
}
/* EV: Third Eye's EV page (verifications, insurance wise, type / status) from the uploaded EV production file */
function crBuildEV(c) {
  const R = c.R, ds = c.ds("ev"); if (!ds) return null;
  const all = c.rows("ev", null), prev = c.hasPrev("ev") ? c.prev("ev") : null, wd = crWorkingDays(c.range.start, c.range.end);
  const payers = new Set(all.map((r) => r.payerKey).filter(Boolean)).size, people = new Set(all.map((r) => r.workBy).filter(Boolean)).size;
  const kpis = [crKpi("Verifications", crF.int(all.length), { delta: crDelta(all.length, prev ? prev.length : null), fmt: crF.int, accent: true }),
    crKpi("A working day", wd ? crF.int(all.length / wd) : "–", { sub: wd + " working days" }),
    crKpi("Insurances", crF.int(payers), { sub: "checked at least once" })];
  if (people) kpis.push(crKpi("Done by", crF.int(people), { sub: people === 1 ? "person" : "people" }));
  const cards = [];
  crAddCard(cards, crCardBar(c, "payerKey", "Insurance wise breakdown", { role: "ev", cols: 6, prev: true, maxRows: 12 }), 1);
  crAddCard(cards, crCardBar(c, "status", "Verification type / status", { role: "ev", cols: 6, type: "col" }), 1);
  const ins = [`${crF.int(all.length)} eligibility verifications were completed in ${crRangeLabel(c.range)}${wd ? `, about ${crF.int(all.length / wd)} a working day` : ""}.`];
  const st = crAgg(all, "status", ds); if (st[0]) ins.push(`${st[0].label} made up ${crF.pct(st[0].share, 0)} of verifications.`);
  const py = crAgg(all, "payerKey", ds); if (py[0]) ins.push(`${py[0].label} was checked most: ${crF.int(py[0].count)} verifications (${crF.pct(py[0].share, 0)}).`);
  if (prev) { const h = crHeadline(R, "Verifications", all.length, prev.length, crF.int, { plural: true }); if (h) ins.push(h); }
  return { title: `${crPeriodWord(R)} EV report`, headline: `${crF.int(all.length)} eligibility verifications`, sub: `${R.client} · ${crRangeLabel(c.range)}`, watermark: "EV", kpis, cards, insights: ins,
    slicers: ["payerKey", "status", "workBy"].filter((f) => all.some((r) => r[f])), claims: crClaims(ds, all, "ev") };
}
/* the executive summary: the headline numbers from the pages, the six-month trend, what we need from the client, the focus */
function crBuildExec(c, raw) {
  const R = c.R, DS = c.DS;
  const inv = crInvSets({ ...c, sel: {} }), amtCur = crSum(inv.curSet, (r) => r.amount), amtPrev = crSum(inv.prevSet, (r) => r.amount);
  const over = (set) => crSum(set.filter((r) => r.bucketLo >= 91), (r) => r.amount), o90 = amtCur ? over(inv.curSet) / amtCur : null, o90p = amtPrev ? over(inv.prevSet) / amtPrev : null;
  const c0 = { ...c, sel: {} }, posted = (rows) => rows.filter((r) => /posted/.test(r.status || "")), paidOf = (r) => (r.paid != null ? r.paid : r.amount) || 0;
  const pay = c0.ds("payment") ? posted(c0.rowsAll("payment")) : [], payP = c0.ds("payment") && c0.hasPrev("payment") ? posted(c0.prev("payment")) : null;
  const coll = crSum(pay, paidOf), collP = payP ? crSum(payP, paidOf) : null;
  const wk = c0.ds("worked") ? c0.rowsAll("worked") : [], wkP = c0.hasPrev("worked") ? c0.prev("worked") : null, wd = crWorkingDays(R.range.start, R.range.end);
  const den = wk.filter(crIsDenied), denP = wkP ? wkP.filter(crIsDenied) : null, dr = wk.length ? den.length / wk.length : null, drP = wkP && wkP.length ? denP.length / wkP.length : null;
  const subs = c0.ds("submission") ? c0.rowsAll("submission").filter((r) => crSubState(r) === "submitted") : [], rej = c0.ds("rejection") ? c0.rowsAll("rejection") : [];
  const spark = (raw.trend || []).filter((t) => t.ar != null).map((t) => t.ar);
  const kpis = [
    crKpi("AR balance", crF.money(amtCur, 0), { sub: inv.twoSnapshots ? `from ${crF.money(amtPrev, 0)}` : `${crF.int(crN(inv.curSet))} claims`, delta: inv.twoSnapshots ? crDelta(amtCur, amtPrev) : null, upGood: false, fmt: crF.moneyK, spark: spark.length >= 3 ? spark : null }),
    crKpi("Collected", crF.money(coll, 0), { sub: collP != null ? `from ${crF.money(collP, 0)}` : `${crF.int(pay.length)} payment lines`, delta: collP != null ? crDelta(coll, collP) : null, fmt: crF.moneyK }),
    crKpi("Over 90 days", o90 == null ? "–" : crF.pct(o90, 1), { sub: `${crF.money(over(inv.curSet), 0)} of AR`, delta: o90 != null && o90p != null ? crPtDelta(o90, o90p) : null, upGood: false }),
    crKpi("Claims worked", crF.int(wk.length), { sub: wd ? `${crF.int(wk.length / wd)} a working day` : "", delta: wkP ? crDelta(wk.length, wkP.length) : null, fmt: crF.int }),
    crKpi("Denial rate", dr == null ? "–" : crF.pct(dr, 1), { sub: `${crF.int(den.length)} claims`, delta: dr != null && drP != null ? crPtDelta(dr, drP) : null, upGood: false }),
    crKpi("Claims submitted", crF.int(subs.length), { sub: subs.length ? `${crF.pct(rej.length / subs.length, 1)} rejected · ${crF.money(crSum(subs, (r) => r.amount), 0)} billed` : `${crF.int(rej.length)} rejected` }),
  ];
  const ins = [];
  if (inv.twoSnapshots && amtPrev) ins.push(`AR is ${amtCur <= amtPrev ? "down" : "up"} ${crF.money(Math.abs(amtPrev - amtCur), 0)} (${crF.pct(Math.abs(1 - amtCur / amtPrev), 0)}): ${crF.money(amtPrev, 0)} to ${crF.money(amtCur, 0)}.`);
  if (collP != null && collP) ins.push(`Collections ${coll >= collP ? "rose" : "fell"} ${crF.pct(Math.abs(coll / collP - 1), 0)} to ${crF.money(coll, 0)}${pay.length ? (() => { const p = crAgg(pay, "payerKey", DS.payment, { measure: "amount" })[0]; return p ? `; ${p.label} paid ${crF.pct(p.share, 0)} of it` : ""; })() : ""}.`);
  else if (coll) ins.push(`${crF.money(coll, 0)} was collected across ${crF.int(pay.length)} payment lines.`);
  if (dr != null) { const top = den.length ? crAgg(den, "status", DS.worked, { measure: "amount" })[0] : null; ins.push(`Denials were ${crF.pct(dr, 1)} of claims worked${drP != null ? ` (${crF.pct(drP, 1)} in the ${crPrevWord(R)})` : ""}${top ? `; ${top.label} is the top reason` : ""}.`); }
  const evN = c0.ds("ev") ? c0.rowsAll("ev").length : 0; if (evN) ins.push(`${crF.int(evN)} eligibility verifications were done${wd ? `, about ${crF.int(evN / wd)} a working day` : ""}.`);
  if (o90 != null) ins.push(`${crF.pct(o90, 0)} of the open balance is older than 90 days${o90p != null ? ` (${crF.pct(o90p, 0)} before)` : ""}.`);
  // what we need from the client: open requests, biggest first
  const asks = (raw.asks || []).slice(0, 4).map((a) => `${a.what} · ${crF.int(a.n)} claim${a.n === 1 ? "" : "s"} · ${crF.money(a.amt, 0)}${a.since ? " · since " + crF.dateShort(crD(a.since)) : ""}`);
  const openN = crSum(raw.asks || [], (a) => a.n), oldest = (raw.asks || []).map((a) => a.since).filter(Boolean).sort()[0];
  // the focus for the next period, from the numbers (the team edits it)
  const focus = [];
  if (den.length) { const t = crAgg(den, "status", DS.worked, { measure: "amount" })[0]; if (t) focus.push(`Work the ${crF.int(t.count)} "${t.label}" denials (${crF.money(t.amount, 0)}) to appeal or correction.`); }
  const yearOld = inv.curSet.filter((r) => r.bucketLo >= 366); if (yearOld.length) focus.push(`Clear ${crF.int(crN(yearOld))} claims older than a year (${crF.money(crSum(yearOld, (r) => r.amount), 0)}) before filing limits close.`);
  const rejOpen = rej.filter((r) => !/corrected|resubmit/.test(r.action || "")); if (rejOpen.length) focus.push(`Correct and resubmit ${crF.int(rejOpen.length)} rejected claims still open.`);
  if (openN) focus.push(`Close the ${crF.int(openN)} requests waiting on the client${oldest ? " (oldest since " + crF.dateShort(crD(oldest)) + ")" : ""}.`);
  return { title: "Executive summary", headline: `${R.periodName} at a glance`, sub: `${R.client} · ${crRangeLabel(R.range)}${R.compare ? ", compared with the " + crPrevWord(R) : ""}`, watermark: "SUMMARY", kpis, cards: [], insights: ins,
    exec: { asks, openN, oldest, focus: focus.slice(0, 4), trend: raw.trend || [] }, slicers: [] };
}
const CR_PAGES = [
  { id: "cover", title: "Cover" },
  { id: "exec", title: "Executive summary" },
  { id: "ev", title: "EV", build: crBuildEV },
  { id: "submission", title: "Submission", build: crBuildSubmission },
  { id: "rejection", title: "Rejections", build: crBuildRejection },
  { id: "payment", title: "Payment posting", build: crBuildPayment },
  { id: "inventory", title: "Inventory analysis", build: crBuildInventory },
  { id: "inventory2", title: "Inventory breakdown", build: crBuildInventory2 },
  { id: "ar", title: "AR production", build: crBuildAR },
  { id: "denials", title: "Denials", build: crBuildDenials },
  { id: "rca", title: "Top denials: RCA", build: crBuildRCA },
  { id: "ca", title: "Client assistance", build: crBuildCA },
];
const CR_PAGE_BY = Object.fromEntries(CR_PAGES.map((p) => [p.id, p]));
/* insights: the generated lines merged with the team's edits (edited, removed, added) */
function crMergedInsights(auto, ed) {
  const st = (ed && ed.insights) || { edits: {}, removed: [], added: [] }, out = [];
  auto.forEach((t, i) => { const id = "a" + i; if ((st.removed || []).includes(id)) return; const e = st.edits && st.edits[id]; out.push({ id, text: e != null ? e : t, auto: true, edited: e != null }); });
  for (const a of st.added || []) out.push({ id: a.id, text: a.text, auto: false, edited: true });
  return { list: out, removed: (st.removed || []).length };
}

/* ---------- charts: Third Eye's SVG charts (hover tips, click to filter, faded when another bar is picked), in the slide's colours ---------- */
const CR_SERIES = ["#13b9a7", "#16156A", "#e8a33d", "#7a5af8", "#d94f70", "#5b8def", "#7b8794", "#2eb872"];
const CR_PREV = "#c5cedb", CR_MUTED = "#cfe3e0", CR_NEG = "#e05a5a";
const crNiceMax = (v) => { if (!v || v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
const crNiceScale = (maxV, n = 4) => { if (!maxV || maxV <= 0) return { max: 1, ticks: [0, 1] }; const step = crNiceMax(maxV / n), max = Math.ceil(maxV / step - 1e-9) * step, ticks = []; for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v); return { max, ticks }; };
const crTip = (title, rows) => `data-tip="${crEsc(JSON.stringify({ t: title, r: rows }))}"`;
const crRR = (x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); if (w <= 0) return ""; return `M${x},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x} Z`; };
const crRT = (x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); if (h <= 0) return ""; return `M${x},${y + h} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h} Z`; };
const crRL = (x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); if (w <= 0) return ""; return `M${x + w},${y} H${x + r} A${r},${r} 0 0 0 ${x},${y + r} V${y + h - r} A${r},${r} 0 0 0 ${x + r},${y + h} H${x + w} Z`; };
const crAct = (dim, key) => (dim ? `data-dim="${crEsc(dim)}" data-key="${crEsc(key)}"` : "");
function crHBar(o) {
  const { items, width, dim, fmtV = crF.num, measureLabel = "Claims", secondary = null, maxRows = 14, emphasis = null, prevItems = null, rowH = 24 } = o;
  const barH = 13, left = crClamp(Math.round(width * 0.34), 100, 210), right = 64, top = 4, shown = items.slice(0, maxRows), h = top + shown.length * rowH + 4;
  if (!shown.length) return `<div class="crc-empty">No data for this selection</div>`;
  const max = Math.max(...shown.map((x) => x.value), ...(prevItems ? prevItems.map((x) => x.value) : [0])) || 1, sc = (v) => (v / max) * (width - left - right);
  let s = `<svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img">`;
  shown.forEach((x, i) => {
    const y = top + i * rowH + (rowH - barH) / 2, w = Math.max(sc(x.value), x.value > 0 ? 2 : 0), fill = x.color || (emphasis ? (x.emph ? CR_SERIES[0] : CR_MUTED) : CR_SERIES[0]);
    const rows = [[measureLabel, fmtV(x.value)]]; if (secondary) rows.push([secondary.label, secondary.fmt(x[secondary.key])]); if (x.share != null) rows.push(["Share", crF.pct(x.share, 1)]); if (x.cum != null) rows.push(["Cumulative", crF.pct(x.cum, 0)]);
    const p = prevItems ? prevItems.find((y2) => y2.key === x.key) : null; if (prevItems) rows.push(["Previous period", p ? fmtV(p.value) : "0"]);
    const tip = crTip(x.label, rows), act = x.isOther ? "" : crAct(dim, x.key);
    s += `<text class="crc-cat${x.dim ? " dim" : ""}" x="${left - 8}" y="${y + barH / 2 + 4}" text-anchor="end" ${act} ${tip}>${crEsc(crTrunc(x.label, Math.floor(left / 6.4)))}</text>`;
    if (p) s += `<rect x="${left}" y="${y + barH - 3}" width="${sc(p.value)}" height="4" fill="${CR_PREV}" rx="2"/>`;
    s += `<rect class="crc-hit" x="${left}" y="${top + i * rowH}" width="${width - left}" height="${rowH}" fill="transparent" ${act} ${tip}/>`;
    s += `<path class="crc-bar${x.dim ? " dim" : ""}${x.sel ? " sel" : ""}" d="${crRR(left, y, w, barH, 4)}" fill="${fill}" ${act} ${tip}/>`;
    s += `<text class="crc-val${x.dim ? " muted" : ""}" x="${left + w + 6}" y="${y + barH / 2 + 4}">${crEsc(fmtV(x.value) + (x.cum != null && emphasis ? "  ·  " + crF.pct(x.cum, 0) : ""))}</text>`;
  });
  s += `</svg>`;
  if (prevItems) s += `<div class="crc-legend"><span><i style="background:${CR_SERIES[0]}"></i>This period</span><span><i style="background:${CR_PREV};height:4px"></i>Previous period</span></div>`;
  if (emphasis) s += `<div class="crc-legend"><span><i style="background:${CR_SERIES[0]}"></i>Within the top 80%</span><span><i style="background:${CR_MUTED}"></i>The rest</span><span class="crc-hint">value · cumulative share</span></div>`;
  if (items.length > maxRows) s += `<div class="crc-note">Top ${maxRows} of ${items.length}; the table view has them all.</div>`;
  return s;
}
function crColumns(o) {
  const { items, width, dim, fmtV = crF.num, measureLabel = "Claims", secondary = null, height = 220, prevItems = null, color = CR_SERIES[0] } = o;
  if (!items.length) return `<div class="crc-empty">No data for this selection</div>`;
  const left = 44, right = 8, top = 20, bottom = 30, pw = width - left - right, ph = height - top - bottom, n = items.length, slot = pw / n, bw = Math.min(30, slot * 0.56);
  const sc0 = crNiceScale(Math.max(...items.map((x) => x.value), ...(prevItems ? prevItems.map((x) => x.value) : [0])), 4), sc = (v) => (v / sc0.max) * ph;
  let s = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`;
  for (const t of sc0.ticks) { const y = top + ph - sc(t); s += `<line class="crc-grid" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text class="crc-axis" x="${left - 6}" y="${y + 4}" text-anchor="end">${crEsc(fmtV(t))}</text>`; }
  items.forEach((x, i) => {
    const cx = left + slot * i + slot / 2, bh = sc(x.value), y = top + ph - bh, p = prevItems ? prevItems.find((q) => q.key === x.key) : null;
    const rows = [[measureLabel, fmtV(x.value)]]; if (secondary) rows.push([secondary.label, secondary.fmt(x[secondary.key])]); if (x.share != null) rows.push(["Share", crF.pct(x.share, 1)]); if (prevItems) rows.push(["Previous period", p ? fmtV(p.value) : "0"]);
    const tip = crTip(x.label, rows), act = x.isOther ? "" : crAct(dim, x.key);
    s += `<rect class="crc-hit" x="${left + slot * i}" y="${top}" width="${slot}" height="${ph + bottom}" fill="transparent" ${act} ${tip}/>`;
    if (p) { const pbh = sc(p.value); s += `<path d="${crRT(cx - bw / 2 - 7, top + ph - pbh, 5, pbh, 2)}" fill="${CR_PREV}"/>`; }
    s += `<path class="crc-bar${x.dim ? " dim" : ""}${x.sel ? " sel" : ""}" d="${crRT(cx - bw / 2, y, bw, bh, 4)}" fill="${x.color || color}" ${act} ${tip}/>`;
    if (n <= 12) s += `<text class="crc-val${x.dim ? " muted" : ""}" x="${cx}" y="${y - 5}" text-anchor="middle">${crEsc(fmtV(x.value))}</text>`;
    s += `<text class="crc-cat${x.dim ? " dim" : ""}" x="${cx}" y="${top + ph + 17}" text-anchor="middle" ${act} ${tip}>${crEsc(crTrunc(x.label.replace(/ days$/, ""), Math.max(6, Math.floor(slot / 6))))}</text>`;
  });
  s += `<line class="crc-base" x1="${left}" x2="${width - right}" y1="${top + ph}" y2="${top + ph}"/></svg>`;
  if (prevItems) s += `<div class="crc-legend"><span><i style="background:${color}"></i>This period</span><span><i style="background:${CR_PREV};width:5px"></i>Previous period</span></div>`;
  return s;
}
function crGrouped(o) {
  const { items, width, dim, fmtV = crF.num, height = 230, labels = ["Previous", "Current"] } = o;
  if (!items.length) return `<div class="crc-empty">No data</div>`;
  const left = 50, right = 8, top = 20, bottom = 30, pw = width - left - right, ph = height - top - bottom, n = items.length, slot = pw / n, bw = Math.min(26, slot * 0.32);
  const sc0 = crNiceScale(Math.max(...items.map((x) => Math.max(x.prev || 0, x.cur || 0))), 4), sc = (v) => (v / sc0.max) * ph;
  let s = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">`;
  for (const t of sc0.ticks) { const y = top + ph - sc(t); s += `<line class="crc-grid" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text class="crc-axis" x="${left - 6}" y="${y + 4}" text-anchor="end">${crEsc(fmtV(t))}</text>`; }
  items.forEach((x, i) => {
    const cx = left + slot * i + slot / 2, act = crAct(dim, x.key);
    const tip = crTip(CR_BK_BY[x.key] ? CR_BK_BY[x.key].label : x.label, [[labels[0], fmtV(x.prev || 0)], [labels[1], fmtV(x.cur || 0)], ["Change", x.prev ? crF.signed(((x.cur || 0) - x.prev) / x.prev, (v) => crF.pct(v, 0)) : "–"]]);
    s += `<rect class="crc-hit" x="${left + slot * i}" y="${top}" width="${slot}" height="${ph + bottom}" fill="transparent" ${act} ${tip}/>`;
    const h0 = sc(x.prev || 0), h1 = sc(x.cur || 0);
    s += `<path class="crc-bar${x.dim ? " dim" : ""}" d="${crRT(cx - bw - 2, top + ph - h0, bw, h0, 4)}" fill="${CR_PREV}" ${act} ${tip}/>`;
    s += `<path class="crc-bar${x.dim ? " dim" : ""}${x.sel ? " sel" : ""}" d="${crRT(cx + 2, top + ph - h1, bw, h1, 4)}" fill="${CR_SERIES[0]}" ${act} ${tip}/>`;
    s += `<text class="crc-val${x.dim ? " muted" : ""}" x="${cx + 2 + bw / 2}" y="${top + ph - h1 - 5}" text-anchor="middle">${crEsc(fmtV(x.cur || 0))}</text>`;
    s += `<text class="crc-cat${x.dim ? " dim" : ""}" x="${cx}" y="${top + ph + 17}" text-anchor="middle" ${act} ${tip}>${crEsc(x.label)}</text>`;
  });
  s += `<line class="crc-base" x1="${left}" x2="${width - right}" y1="${top + ph}" y2="${top + ph}"/></svg>`;
  s += `<div class="crc-legend"><span><i style="background:${CR_PREV}"></i>${crEsc(labels[0])}</span><span><i style="background:${CR_SERIES[0]}"></i>${crEsc(labels[1])}</span></div>`;
  return s;
}
function crDiverge(o) {
  const { items, width, fmtV = crF.num, posLabel = "Reduced", negLabel = "Increased", dim } = o;
  if (!items.length) return `<div class="crc-empty">No data</div>`;
  const rowH = 26, barH = 13, left = 92, right = 8, top = 4, h = top + items.length * rowH + 4, max = Math.max(...items.map((x) => Math.abs(x.value))) || 1;
  const zero = left + (width - left - right) / 2, half = (width - left - right) / 2 - 58, sc = (v) => (Math.abs(v) / max) * half;
  let s = `<svg viewBox="0 0 ${width} ${h}" width="${width}" height="${h}" role="img"><line class="crc-base" x1="${zero}" x2="${zero}" y1="${top}" y2="${h - 2}"/>`;
  items.forEach((x, i) => {
    const y = top + i * rowH + (rowH - barH) / 2, w = sc(x.value), act = crAct(dim, x.key);
    const tip = crTip(x.label, [[x.value >= 0 ? posLabel : negLabel, fmtV(Math.abs(x.value))], ["Then", fmtV(x.prev)], ["Now", fmtV(x.cur)]]);
    s += `<text class="crc-cat" x="${left - 8}" y="${y + barH / 2 + 4}" text-anchor="end" ${act} ${tip}>${crEsc(crTrunc(x.label, 16))}</text>`;
    s += `<rect class="crc-hit" x="${left}" y="${top + i * rowH}" width="${width - left}" height="${rowH}" fill="transparent" ${act} ${tip}/>`;
    if (x.value >= 0) s += `<path class="crc-bar${x.dim ? " dim" : ""}" d="${crRR(zero, y, w, barH, 4)}" fill="${CR_SERIES[0]}" ${act} ${tip}/><text class="crc-val pos" x="${zero + w + 6}" y="${y + barH / 2 + 4}">−${crEsc(fmtV(x.value))}</text>`;
    else s += `<path class="crc-bar${x.dim ? " dim" : ""}" d="${crRL(zero - w, y, w, barH, 4)}" fill="${CR_NEG}" ${act} ${tip}/><text class="crc-val neg" x="${zero - w - 6}" y="${y + barH / 2 + 4}" text-anchor="end">+${crEsc(fmtV(-x.value))}</text>`;
  });
  s += `</svg><div class="crc-legend"><span><i style="background:${CR_SERIES[0]}"></i>${crEsc(posLabel)}</span><span><i style="background:${CR_NEG}"></i>${crEsc(negLabel)}</span></div>`;
  return s;
}
function crDonut(o) {
  const { items, width, dim, fmtV = crF.num, measureLabel = "Claims", centerLabel = "", centerValue = "", maxSize = 170 } = o;
  if (!items.length) return `<div class="crc-empty">No data for this selection</div>`;
  const size = Math.min(maxSize, width * 0.45), r = size / 2 - 6, ri = r * 0.62, cx = size / 2, cy = size / 2, total = crSum(items, (x) => x.value) || 1;
  let a0 = -Math.PI / 2, paths = "";
  items.forEach((x, i) => {
    const frac = x.value / total; if (frac <= 0) return; const a1 = a0 + frac * Math.PI * 2, large = frac > 0.5 ? 1 : 0, p = (ang, rr) => [cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)];
    const [x0, y0] = p(a0, r), [x1, y1] = p(a1, r), [x2, y2] = p(a1, ri), [x3, y3] = p(a0, ri);
    const d = frac >= 0.9999 ? `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx - 0.01},${cy - r} L${cx - 0.01},${cy - ri} A${ri},${ri} 0 1 0 ${cx},${cy - ri} Z` : `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${ri},${ri} 0 ${large} 0 ${x3},${y3} Z`;
    paths += `<path class="crc-bar${x.dim ? " dim" : ""}" d="${d}" fill="${x.color || CR_SERIES[i % CR_SERIES.length]}" stroke="#fff" stroke-width="2" ${x.isOther ? "" : crAct(dim, x.key)} ${crTip(x.label, [[measureLabel, fmtV(x.value)], ["Share", crF.pct(frac, 1)]])}/>`;
    a0 = a1;
  });
  let s = `<div class="crc-donut"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="flex:none">${paths}<text x="${cx}" y="${cy + 2}" text-anchor="middle" class="crc-center">${crEsc(centerValue)}</text><text x="${cx}" y="${cy + 18}" text-anchor="middle" class="crc-axis">${crEsc(centerLabel)}</text></svg><div class="crc-legend col">`;
  items.forEach((x, i) => { s += `<span style="${x.dim ? "opacity:.45" : ""};cursor:${x.isOther ? "default" : "pointer"}" ${x.isOther ? "" : crAct(dim, x.key)}><i style="background:${x.color || CR_SERIES[i % CR_SERIES.length]}"></i><em>${crEsc(crTrunc(x.label, 26))}</em><b>${crEsc(fmtV(x.value))}</b><small>${crEsc(crF.pct(x.value / total, 0))}</small></span>`; });
  return s + `</div></div>`;
}
function crItemTable(o) {
  const { items, measureLabel = "Claims", fmtV = crF.num, secondary = null, dimLabel = "Category", dim } = o, total = crSum(items, (x) => x.value);
  let s = `<div class="crc-tbl"><table><thead><tr><th>${crEsc(dimLabel)}</th><th class="n">${crEsc(measureLabel)}</th>${secondary ? `<th class="n">${crEsc(secondary.label)}</th>` : ""}<th class="n">Share</th></tr></thead><tbody>`;
  for (const x of items) s += `<tr ${x.isOther ? "" : crAct(dim, x.key)} class="${x.dim ? "dimrow" : ""}"><td>${crEsc(x.label)}</td><td class="n">${crEsc(fmtV(x.value))}</td>${secondary ? `<td class="n">${crEsc(secondary.fmt(x[secondary.key]))}</td>` : ""}<td class="n">${crEsc(crF.pct(total ? x.value / total : 0, 1))}</td></tr>`;
  return s + `<tr class="total"><td>Total</td><td class="n">${crEsc(fmtV(total))}</td>${secondary ? `<td class="n">${crEsc(secondary.fmt(crSum(items, (x) => x[secondary.key])))}</td>` : ""}<td class="n">100%</td></tr></tbody></table></div>`;
}
/* the six-month trend on the executive summary: AR at each month end (line) and what was collected (columns) */
function crTrend6(trend, width, height) {
  const pts = trend || []; if (!pts.length) return `<div class="crc-empty">The trend fills in month by month.</div>`;
  const pl = 14, pb = 22, pt = 18, ph = height - pb - pt, gw = (width - pl * 2) / pts.length, cmax = Math.max(1, ...pts.map((x) => x.coll || 0)) / 0.46;
  const arV = pts.map((x) => x.ar).filter((v) => v != null), amin = Math.min(...arV, Infinity), amax = Math.max(...arV, -Infinity);
  const sx = (i) => pl + i * gw + gw / 2, sy = (v) => pt + 2 + ph * 0.24 * (amax === amin ? 0.5 : 1 - (v - amin) / (amax - amin));
  const mlab = (m) => CRM_S[+m.slice(5, 7) - 1];
  let s = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`;
  pts.forEach((x, i) => { const cx = sx(i), ch = ph * (x.coll || 0) / cmax, last = i === pts.length - 1;
    s += `<rect x="${cx - 20}" y="${pt + ph - ch}" width="40" height="${ch}" rx="5" fill="${last ? CR_SERIES[0] : "#bfe8e2"}" ${crTip(mlab(x.m) + " " + x.m.slice(0, 4), [["Collected", crF.money(x.coll || 0, 0)], ["AR at month end", x.ar == null ? "not kept" : crF.money(x.ar, 0)]])}/>`;
    if (x.coll) s += `<text x="${cx}" y="${pt + ph - ch - 4}" class="crc-val pos" text-anchor="middle">${crEsc(crF.moneyK(x.coll))}</text>`;
    s += `<text x="${cx}" y="${height - 6}" class="crc-axis" text-anchor="middle">${mlab(x.m)}</text>`; });
  const line = pts.map((x, i) => (x.ar == null ? null : [sx(i), sy(x.ar)])).filter(Boolean);
  if (line.length > 1) s += `<path d="${line.map((p, i) => (i ? "L" : "M") + p[0] + "," + p[1]).join(" ")}" fill="none" stroke="#16156A" stroke-width="2.5"/>`;
  pts.forEach((x, i) => { if (x.ar == null) return; s += `<circle cx="${sx(i)}" cy="${sy(x.ar)}" r="4" fill="#fff" stroke="#16156A" stroke-width="2"/><text x="${sx(i) + 24}" y="${sy(x.ar) - 6}" class="crc-val navy" text-anchor="middle">${crEsc(crF.moneyK(x.ar))}</text>`; });
  return s + `</svg>`;
}
function crSpark(pts, w, h, color) {
  if (!pts || pts.length < 2) return ""; const max = Math.max(...pts), min = Math.min(...pts), sx = (i) => i * (w - 6) / (pts.length - 1) + 3, sy = (v) => h - 4 - (h - 10) * (v - min) / (max - min || 1);
  return `<svg width="${w}" height="${h}"><path d="${pts.map((v, i) => (i ? "L" : "M") + sx(i) + "," + sy(v)).join(" ")}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${sx(pts.length - 1)}" cy="${sy(pts[pts.length - 1])}" r="4" fill="${color}"/></svg>`;
}
/* one card's chart, at a given width (the slide body shrinks to fit, and charts are drawn for the width they get) */
function crRenderCard(card, width, o = {}) {
  if (card.type === "empty") return `<div class="crc-empty">No rows for this selection</div>`;
  if (o.table && card.items) return crItemTable({ items: card.items, measureLabel: card.measureLabel, fmtV: card.fmtT || card.fmtV, secondary: card.secondary, dimLabel: card.dimLabel, dim: card.dim });
  const h = o.h || 210;
  switch (card.type) {
    case "hbar": return crHBar({ items: card.items, width, dim: card.dim, fmtV: card.fmtV, measureLabel: card.measureLabel, secondary: card.secondary, maxRows: Math.min(card.maxRows || 14, o.maxRows || 10), emphasis: card.emphasis, prevItems: card.prevItems, rowH: o.rowH || 23 });
    case "col": return crColumns({ items: card.items, width, dim: card.dim, fmtV: card.fmtV, measureLabel: card.measureLabel, secondary: card.secondary, height: h, prevItems: card.prevItems, color: card.color });
    case "grouped": return crGrouped({ items: card.items, width, dim: card.dim, fmtV: card.fmtV, height: h + 20, labels: card.labels });
    case "donut": return crDonut({ items: card.items, width, dim: card.dim, fmtV: card.fmtV, measureLabel: card.measureLabel, centerValue: card.centerValue, centerLabel: card.centerLabel, maxSize: Math.min(170, h - 10) });
    case "diverge": return crDiverge({ items: card.items, width, fmtV: card.fmtV, posLabel: card.posLabel, negLabel: card.negLabel, dim: card.dim });
    case "table": return `<div class="crc-tbl"><table><thead><tr>${card.head.map((x, i) => `<th class="${i > 0 ? "n" : ""}">${crEsc(x)}</th>`).join("")}</tr></thead><tbody>${card.rows.map((r) => `<tr>${r.map((v, i) => `<td class="${i > 0 ? "n" : ""}">${crEsc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  return "";
}

/* ---------- the slide: 1280 × 720, the same page on screen, presenting and in the PDF ---------- */
const CR_W = 1280, CR_H = 720, CR_BODY_W = 1192, CR_AVAIL_H = 720 - 30 - 84 - 3 - 44 - 14;
const crInitials = (name) => String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "C";
function CrBrand({ rep }) {
  return <div className="crs-brand"><div className="crs-cname">{rep.client}<small>{rep.locName || "All locations"}</small></div>
    {rep.logo ? <img className="crs-clogo img" src={rep.logo} alt="" /> : <div className="crs-clogo">{crInitials(rep.client)}</div>}</div>;
}
function CrFoot({ rep, n, total }) {
  return <div className="crs-ft"><span><img src={PURVIEW_MARK} alt="" />{rep.client} · {rep.reportName} · {rep.periodLabel}</span><span>Prepared by Purview Healthcare · Confidential · {n} / {total}</span></div>;
}
/* text a supervisor can change in place (saved when they click away) */
function CrEditable({ value, onSave, className, tag = "div", placeholder }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.textContent = value || ""; }, [value]);
  const T = tag;
  return <T ref={ref} className={(className || "") + " crs-ed"} contentEditable suppressContentEditableWarning data-ph={placeholder || ""}
    onBlur={(e) => { const v = e.currentTarget.textContent.replace(/\s+/g, " ").trim(); if (v !== (value || "")) onSave(v); }}
    onKeyDown={(e) => { if (e.key === "Enter" && tag !== "div") { e.preventDefault(); e.currentTarget.blur(); } }} />;
}
function CrKpi({ k, prevWord }) {
  let d = null;
  if (k.delta && k.delta.prev != null && k.delta.cur != null) {
    const x = k.delta, flat = !x.diff, good = (x.diff > 0) === k.upGood;
    const txt = x.pts ? (Math.abs(x.diff * 100) < 0.05 ? "no change" : `${x.diff > 0 ? "▲" : "▼"} ${Math.abs(x.diff * 100).toFixed(1)} pts`)
      : flat ? "no change" : `${x.diff > 0 ? "▲" : "▼"} ${x.pct == null ? crF.signed(x.diff, k.fmt || crF.num) : crF.pct(Math.abs(x.pct), 0)}`;
    d = <span className={"crs-chip " + (flat ? "n" : good ? "g" : "r")} title={"against the " + prevWord + (k.fmt && !x.pts ? " (" + k.fmt(x.prev) + ")" : "")}>{txt}</span>;
  }
  return <div className={"crs-k" + (k.accent ? " acc" : "")}>
    <div className="l">{k.label}</div><div className={"v" + (k.small ? " sm" : "")}>{k.value}</div><div className="s">{d}{k.sub}</div>
    {k.spark && <div className="crs-spark" dangerouslySetInnerHTML={{ __html: crSpark(k.spark, 74, 30, "#13b9a7") }} />}
  </div>;
}
function CrInsights({ model, ed, mode, onEd, max }) {
  const { list, removed } = crMergedInsights(model.insights || [], ed);
  const [add, setAdd] = useState("");
  const [more, setMore] = useState(false);
  const edit = mode === "edit";
  const st = (ed && ed.insights) || { edits: {}, removed: [], added: [] };
  const put = (next) => onEd({ ...(ed || {}), insights: next });
  const shown = edit && more ? list : list.slice(0, max || 6);
  if (!edit && !shown.length) return null;
  return <div className="crs-ins">
    <div className="row between"><h5>Insights</h5>{edit && <span className="crs-tools-r">{removed ? <button type="button" onClick={() => put({ ...st, removed: [] })}>Show {removed} hidden</button> : null}
      <button type="button" title="Bring back the generated insights and drop the edits" onClick={() => put({ edits: {}, removed: [], added: [] })}>Reset</button></span>}</div>
    <ul>{shown.map((it) => <li key={it.id} className={it.auto ? "" : "user"}>
      {edit ? <CrEditable tag="span" value={it.text} onSave={(v) => it.auto ? put({ ...st, edits: { ...(st.edits || {}), [it.id]: v } }) : put({ ...st, added: (st.added || []).map((a) => a.id === it.id ? { ...a, text: v } : a) })} /> : <span>{it.text}</span>}
      {edit && <span className="crs-x"><i>{it.auto ? (it.edited ? "edited" : "auto") : "added"}</i><button type="button" title="Remove" onClick={() => it.auto ? put({ ...st, removed: [...(st.removed || []), it.id] }) : put({ ...st, added: (st.added || []).filter((a) => a.id !== it.id) })}>✕</button></span>}
    </li>)}</ul>
    {edit && <div className="crs-add"><input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add your own insight (for example: Superior is reprocessing the COB denials; payment expected in week 2)"
      onKeyDown={(e) => { if (e.key === "Enter" && add.trim()) { put({ ...st, added: [...(st.added || []), { id: "u" + Date.now(), text: add.trim() }] }); setAdd(""); } }} />
      <button type="button" disabled={!add.trim()} onClick={() => { put({ ...st, added: [...(st.added || []), { id: "u" + Date.now(), text: add.trim() }] }); setAdd(""); }}>+ Add</button></div>}
    {edit && list.length > (max || 6) && <div className="crs-warn"><button type="button" onClick={() => setMore(!more)}>{more ? "Show only the lines on the page" : crPl(list.length - (max || 6), "more line") + " not on the page: show"}</button> Only the first {max || 6} print; drop the ones you do not need.</div>}
  </div>;
}
function CrRca({ card, ed, mode, onEd, prevWord }) {
  const saved = (ed && ed.rca) || {}, edit = mode === "edit";
  if (!card.rows.length) return <div className="crc-empty">No denials in this period</div>;
  const set = (key, f, v) => onEd({ ...(ed || {}), rca: { ...saved, [key]: { ...(saved[key] || {}), [f]: v } } });
  return <table className="crs-rca"><thead><tr><th>Denial reason</th><th className="n">Claims</th><th className="n">Amount</th>{card.hasPrev && <th className="n">{crTitle(prevWord)}</th>}<th>Payers</th><th>Issue / root cause</th><th>Mitigation plan</th></tr></thead>
    <tbody>{card.rows.map((r) => { const sv = saved[r.key] || {}, d = card.hasPrev && r.prevCount != null ? crDelta(r.count, r.prevCount) : null;
      return <tr key={r.key}><td><b>{r.reason}</b><div className="crs-mix">{crF.pct(r.share, 0)} of denied dollars{r.actions ? " · action: " + r.actions : ""}</div></td><td className="n">{crF.int(r.count)}</td><td className="n">{crF.money(r.amount, 0)}</td>
        {card.hasPrev && <td className="n">{r.prevCount == null ? "–" : crF.int(r.prevCount) + " · " + crF.money(r.prevAmount, 0)}{d && d.diff ? <div className="crs-mix" style={{ color: d.diff > 0 ? "#c0392b" : "#0b7d6f" }}>{d.diff > 0 ? "▲" : "▼"} {d.pct == null ? crF.signed(d.diff, crF.int) : crF.pct(Math.abs(d.pct), 0)}</div> : null}</td>}
        <td className="crs-mix">{r.payers}</td>
        <td className="w">{edit ? <CrEditable value={sv.rca} onSave={(v) => set(r.key, "rca", v)} placeholder="Why did these claims deny?" /> : sv.rca || <span className="crs-ph">–</span>}</td>
        <td className="w">{edit ? <CrEditable value={sv.plan} onSave={(v) => set(r.key, "plan", v)} placeholder="What will prevent it next time?" /> : sv.plan || <span className="crs-ph">–</span>}</td></tr>; })}</tbody></table>;
}
function CrList({ title, items, ed, field, mode, onEd, dark, placeholder }) {
  const edit = mode === "edit", list = ed && Array.isArray(ed[field]) ? ed[field] : items;
  const [add, setAdd] = useState("");
  const put = (next) => onEd({ ...(ed || {}), [field]: next });
  return <div className={dark ? "crs-ask" : "crs-focus"}><h5>{title}</h5>
    {list.length ? list.map((t, i) => <div key={i} className="it">{edit ? <CrEditable tag="span" value={t} onSave={(v) => put(v ? list.map((x, j) => (j === i ? v : x)) : list.filter((_, j) => j !== i))} /> : <span>{t}</span>}
      {edit && <button type="button" className="crs-xb" onClick={() => put(list.filter((_, j) => j !== i))}>✕</button>}</div>) : <div className="it"><span className="crs-ph">{placeholder}</span></div>}
    {edit && <div className="crs-add sm"><input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add a line" onKeyDown={(e) => { if (e.key === "Enter" && add.trim()) { put([...list, add.trim()]); setAdd(""); } }} />
      {ed && Array.isArray(ed[field]) && <button type="button" title="Back to the lines worked out from the numbers" onClick={() => { const n = { ...(ed || {}) }; delete n[field]; onEd(n); }}>Reset</button>}</div>}
  </div>;
}
function CrSlide({ page, model, rep, n, total, mode, ed, onEd, tools, filterText }) {
  const bodyRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const iter = useRef(0);
  const sig = (model && (model.headline + "|" + (model.kpis || []).length + "|" + (model.cards || []).map((c) => c.id + (c.items ? c.items.length : "")).join(",") + "|" + (model.insights || []).length)) + "|" + mode + "|" + JSON.stringify(ed || {}).length;
  useEffect(() => { iter.current = 0; }, [sig]);
  React.useLayoutEffect(() => {
    const el = bodyRef.current; if (!el || iter.current > 6) return;
    const h = el.scrollHeight; if (!h) return;
    const target = crClamp(Math.min(1, (CR_AVAIL_H / h) * 0.995), 0.55, 1);
    if (Math.abs(target - zoom) > 0.012) { iter.current++; setZoom(target); }
  });
  if (!model) return <div className="crs"><div className="crc-empty" style={{ marginTop: 300 }}>Nothing to show for this page in this period.</div></div>;
  const edit = mode === "edit", live = mode === "edit" || mode === "view";
  const lw = CR_BODY_W / zoom, cw = (cols) => Math.floor((cols / 12) * (lw + 14) - 14 - 30);
  const cards = model.cards || [];
  const rowsOfCards = (() => { let r = 0, acc = 0; for (const c of cards) { if (acc + (c.cols || 6) > 12) { r++; acc = 0; } acc += c.cols || 6; } return cards.length ? r + 1 : 0; })();
  const h = rowsOfCards >= 2 ? 176 : 228;
  const title = ed && ed.title ? ed.title : model.headline || model.title;
  return <div className={"crs" + (mode === "print" ? " print" : "")} data-page={page.id}>
    <div className="crs-wm">{model.watermark}</div>
    <div className="crs-hd"><div style={{ minWidth: 0 }}><div className="crs-eb">{model.title}</div>
      {edit ? <CrEditable tag="h2" className="crs-h2" value={title} onSave={(v) => onEd({ ...(ed || {}), title: v && v !== model.headline ? v : undefined })} /> : <h2 className="crs-h2">{title}</h2>}
      <div className="crs-sub">{model.sub}{filterText ? <b className="crs-filt"> · {filterText}</b> : null}</div></div><CrBrand rep={rep} /></div>
    <div className="crs-rule" />
    <div className="crs-body" ref={bodyRef} style={{ width: lw, transform: zoom < 1 ? `scale(${zoom})` : undefined }}>
      {page.id === "exec" ? <CrExecBody model={model} ed={ed} mode={mode} onEd={onEd} rep={rep} lw={lw} /> : <>
        {model.kpis && model.kpis.length ? <div className="crs-kp" style={{ gridTemplateColumns: `repeat(${model.kpis.length}, 1fr)` }}>{model.kpis.map((k, i) => <CrKpi key={i} k={k} prevWord={rep.prevWord} />)}</div> : null}
        {cards.length ? <div className="crs-cards">{cards.map((c) => c.type === "rca"
          ? <div key={c.id} className="crs-cd" style={{ gridColumn: "span 12" }}><CrRca card={c} ed={ed} mode={mode} onEd={onEd} prevWord={rep.prevWord} /></div>
          : <div key={c.id} className="crs-cd" style={{ gridColumn: `span ${c.cols || 6}` }}>
            <div className="crs-cdh"><div><h4>{c.title}</h4>{c.sub && <div className="cs">{c.sub}</div>}</div>
              {live && (c.canToggle || ["hbar", "col", "donut"].includes(c.type)) && <div className="crs-ct">
                {c.canToggle && <><button type="button" className={c.measure === "count" ? "on" : ""} title="By claim count" onClick={() => tools.setMeasure(c.id, "count")}>#</button><button type="button" className={c.measure === "amount" ? "on" : ""} title="By amount" onClick={() => tools.setMeasure(c.id, "amount")}>$</button></>}
                {["hbar", "col", "donut"].includes(c.type) && <button type="button" className={tools.tableView[c.id] ? "on" : ""} title="Table view" onClick={() => tools.setTable(c.id)}>⊞</button>}</div>}</div>
            <div className="crs-chart" dangerouslySetInnerHTML={{ __html: crRenderCard(c, cw(c.cols || 6), { h, table: live && tools.tableView[c.id], maxRows: rowsOfCards >= 2 ? 7 : 10, rowH: rowsOfCards >= 2 ? 21 : 23 }) }} />
            {c.callout && <div className="crs-callout" dangerouslySetInnerHTML={{ __html: c.callout }} />}</div>)}</div> : null}
        <CrInsights model={model} ed={ed} mode={mode} onEd={onEd} max={page.id === "rca" ? 3 : 6} />
        {model.note ? <div className="crs-note">{model.note}</div> : null}
      </>}
    </div>
    {edit && zoom < 0.72 && <div className="crs-crowd">This page is crowded and prints small: drop an insight or two.</div>}
    <CrFoot rep={rep} n={n} total={total} />
  </div>;
}
function CrExecBody({ model, ed, mode, onEd, rep, lw }) {
  const x = model.exec;
  return <>
    <div className="crs-ex">
      <div><div className="crs-kp" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginTop: 0 }}>{model.kpis.map((k, i) => <CrKpi key={i} k={k} prevWord={rep.prevWord} />)}</div>
        <CrInsights model={{ insights: model.insights }} ed={ed} mode={mode} onEd={onEd} max={4} /></div>
      <div><CrList title="What we need from you" dark items={x.asks.concat(x.openN ? [`${crF.int(x.openN)} requests open${x.oldest ? " · oldest since " + crF.dateShort(crD(x.oldest)) : ""}`] : [])} ed={ed} field="asks" mode={mode} onEd={onEd} placeholder="Nothing is waiting on you." />
        <CrList title={"Our focus for " + rep.nextName} items={x.focus} ed={ed} field="focus" mode={mode} onEd={onEd} placeholder="Add what the team will focus on next." /></div>
    </div>
    <div className="crs-cd crs-trend"><div><h4>The last six months</h4><div className="cs">AR balance at each month end (line) and what was collected (columns)</div></div>
      <div className="crs-chart" dangerouslySetInnerHTML={{ __html: crTrend6(x.trend, Math.floor(lw - 280), 124) }} /></div>
  </>;
}
function CrCover({ rep, pages, mode }) {
  return <div className={"crs-cover" + (mode === "print" ? " print" : "")} data-page="cover"><div className="band" />
    <div className="lg"><img src={PURVIEW_MARK} alt="" />PURVIEW HEALTHCARE</div>
    <div className="t"><div className="e">{rep.reportName}</div><h1>{rep.client}</h1><div className="p">{rep.periodLabel}{rep.locName ? " · " + rep.locName : ""}</div>
      <div className="m">Prepared by Purview Healthcare · {crF.date(new Date())}{rep.prepared ? " · " + rep.prepared : ""}</div></div>
    <div className="toc"><h6>Contents</h6>{pages.filter((p) => p.id !== "cover").map((p, i) => <div key={p.id}><span>{p.title}</span><span>{i + 2}</span></div>)}</div>
    <div className="cl">{rep.logo ? <img src={rep.logo} alt="" /> : <div className="ini">{crInitials(rep.client)}</div>}{rep.client}</div>
    <div className="conf">Confidential · for {rep.client}</div></div>;
}
/* which datasets feed a page, for its slicers */
function crSliceSource(c, pid) {
  if (pid === "inventory" || pid === "inventory2") { const s = crInvSets({ ...c, sel: {} }); return { ds: s.ds, rows: s.curSet }; }
  const role = { ev: "ev", submission: "submission", rejection: "rejection", payment: "payment", ar: "worked", denials: "denial", rca: "denial", ca: "clientAssistance" }[pid];
  return role && c.ds(role) ? { ds: c.ds(role), rows: c.rowsAll(role) } : null;
}
function crHasPage(DS, pid) {
  if (pid === "cover" || pid === "exec") return true;
  if (pid === "inventory" || pid === "inventory2") return !!(DS.inventory && DS.inventory.recs.length);
  const role = { ev: "ev", submission: "submission", rejection: "rejection", payment: "payment", ar: "worked", denials: "denial", rca: "denial", ca: "clientAssistance" }[pid];
  return !!crDerived(DS, role);
}
/* the claims behind what the page shows (current filters), with search and CSV */
const CR_COL_LABEL = { invoice: "Claim", dos: "DOS", bucket: "Age group", payerKey: "Payer", amount: "Amount", purviewStatus: "Status", status: "Reason / sub-status", action: "Action", workDate: "Date", workBy: "Worked by",
  subDate: "Submitted", comment: "Comment", charge: "Charged", paid: "Paid", checkNo: "Check / EFT", paidDate: "Paid on", dept: "Team" };
function crCell(ds, r, c) {
  const v = r[c]; if (v == null || v === "") return "";
  if (v instanceof Date) return crF.date(v);
  if (c === "payerKey" || c === "bucket" || CR_CATS.includes(c)) return crLabelOf(ds, c, v);
  if (c === "amount" || c === "charge" || c === "paid") return crF.money(v, 0);
  return String(v);
}
function CrClaims({ spec, ctx, me, title, onOpen }) {
  const [q, setQ] = useState("");
  if (!spec) return null;
  const rows = q ? spec.rows.filter((r) => spec.cols.some((c) => crCell(spec.ds, r, c).toLowerCase().includes(q.toLowerCase()))) : spec.rows;
  const csv = () => downloadText(toCSV(rows, spec.cols.map((c) => ({ label: CR_COL_LABEL[c] || c, get: (r) => crCell(spec.ds, r, c) }))), (title || "claims").replace(/[\\/:*?"<>|]+/g, " ") + ".csv");
  return <div className="card crx-drawer">
    <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}><div className="row" style={{ gap: 10 }}><b>Claims behind this view</b><span className="badge gray">{crF.int(rows.length)} rows · {crF.money(crSum(rows, (r) => r.amount), 0)}</span></div>
      <div className="row" style={{ gap: 8 }}><input className="input sm" style={{ width: 240 }} placeholder="Search claim, payer, status…" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn sm" onClick={csv} disabled={!rows.length}>⬇ CSV</button></div></div>
    {spec.rows.length ? <div className="table-wrap mt8" style={{ maxHeight: 320 }}><table className="t"><thead><tr>{spec.cols.map((c) => <th key={c} className={["amount", "charge", "paid"].includes(c) ? "num" : ""}>{CR_COL_LABEL[c] || c}</th>)}</tr></thead>
      <tbody>{rows.slice(0, 80).map((r, i) => <tr key={i} className={r.id ? "click" : ""} onClick={() => r.id && onOpen(r.id)}>{spec.cols.map((c) => <td key={c} className={["amount", "charge", "paid"].includes(c) ? "num" : c === "invoice" ? "mono" : ""}>{crCell(spec.ds, r, c)}</td>)}</tr>)}</tbody></table></div>
      : <div className="small muted mt8">{spec.note || "No claims behind this view."}</div>}
    {rows.length > 80 && <div className="tiny muted mt8">Showing 80 of {crF.int(rows.length)}; the CSV has them all. Click a claim to open it.</div>}
  </div>;
}
/* the image the client report shows as the client's logo: picked from OneDrive, shrunk to a small PNG */
/* ---------- EV production files: read in the browser; only the report's columns go to Brahmastra ---------- */
const CR_EV_COLS = [
  ["dos", "DOS", ["dos", "date of service", "service date", "dos date", "dos from", "from dos", "appointment date", "appt date", "visit date"]],
  ["wd", "Date", ["work date", "worked date", "date worked", "date of work", "verification date", "verified date", "date verified", "verified on", "ev date", "eligibility date", "date of verification",
    "checked on", "check date", "date checked", "done on", "completed on", "completed date", "processed date", "processed on", "activity date", "entry date", "date"]],
  ["py", "Insurance", ["insurance", "insurance name", "payer", "payer name", "primary insurance", "primary payer", "insurance company", "insurance carrier", "carrier", "payor", "payor name", "plan", "plan name", "ins name", "ins"]],
  ["st", "Status", ["status", "verification status", "eligibility status", "ev status", "coverage status", "result", "outcome", "eligibility", "findings", "remarks", "remark"]],
  ["ty", "Verification type", ["verification type", "ev type", "type of verification", "check type", "type"]],
  ["act", "Action", ["action", "action taken", "mode", "method", "verified via", "verified through", "verification mode", "source", "channel"]],
  ["by", "Done by", ["done by", "verified by", "worked by", "work by", "checked by", "processed by", "ev done by", "agent", "agent name", "user", "employee", "associate", "resource", "analyst", "team member"]],
  ["no", "Account", ["account", "account no", "account number", "acct", "acct no", "mrn", "chart", "chart no", "invoice", "invoice no", "claim id", "encounter", "encounter no", "visit no", "visit id", "ticket"]],
  ["cm", "Comment", ["comment", "comments", "notes", "note", "description", "details"]],
];
const CR_EV_LABEL = Object.fromEntries(CR_EV_COLS.map(([k, l]) => [k, l]));
const crNormHead = (h) => String(h == null ? "" : h).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function crMatchEV(headers) {
  const H = headers.map((h) => ({ h, n: crNormHead(h) })), used = new Set(), map = {};
  // the patient's name, birth date and member IDs are never read; coverage dates are not the date of the check
  for (const c of H) if (/\b(patient|member|subscriber|guarantor|insured)\b|\b(first|last|full) name\b|\bdob\b|date of birth|\bssn\b|\bphone\b|\baddress\b/.test(c.n)) used.add(c.h);
  const notCheck = /service|\bdos\b|appoint|appt|visit|birth|effective|\beff\b|term|expir|start|end|from|thru|through/;
  for (const [key, , syns] of CR_EV_COLS) {
    let x = null;
    for (const sy of syns) { x = H.find((c) => !used.has(c.h) && c.n === sy); if (x) break; }
    if (!x) for (const sy of syns) { if (sy.length < 4 || (key === "wd" && sy === "date")) continue; x = H.find((c) => !used.has(c.h) && (" " + c.n + " ").includes(" " + sy + " ") && !(key === "wd" && notCheck.test(c.n))); if (x) break; }
    if (x) { used.add(x.h); map[key] = x.h; }
  }
  return map;
}
function crReadEV(bytes, name) {
  let best = null;
  for (const sh of readWorkbook(bytes, name)) { const t = tableFromSheet(sh.rows), map = crMatchEV(t.headers), score = Object.keys(map).length + (map.wd ? 5 : 0) + Math.min(3, t.rows.length / 100);
    if (!best || score > best.score) best = { t, map, score }; }
  if (!best || !best.t.rows.length) throw new Error("That file has no rows to read.");
  const { t, map } = best, txt = (r, k, n) => (map[k] ? crClean(r[map[k]]) : "").slice(0, n);
  const found = CR_EV_COLS.filter(([k]) => map[k]).map(([k]) => [CR_EV_LABEL[k], String(map[k])]);
  if (!map.wd) return { file: name, noDate: true, found, n: t.rows.length };
  const rows = []; let skipped = 0;
  for (const x of t.rows) {
    const wd = parseDateAny(x[map.wd]); if (!wd) { skipped++; continue; }
    rows.push({ wd, dos: map.dos ? parseDateAny(x[map.dos]) : "", no: txt(x, "no", 60), py: txt(x, "py", 120), st: (txt(x, "st", 120) || txt(x, "ty", 120)), act: txt(x, "act", 120), by: txt(x, "by", 80), cm: txt(x, "cm", 300) });
  }
  if (!rows.length) return { file: name, noDate: true, found, n: t.rows.length };
  let from = rows[0].wd, to = from; for (const x of rows) { if (x.wd < from) from = x.wd; if (x.wd > to) to = x.wd; }
  return { file: name, rows, n: rows.length, skipped, from, to, found };
}
/* the report period a saved key names (month:2026-10, week:2026-10-26, custom:2026-10-01:2026-10-15) */
function crRangeFromKey(k) {
  let m = /^month:(\d{4})-(\d{2})$/.exec(k || ""); if (m) return crRangeMonth(new Date(+m[1], +m[2] - 1, 1));
  m = /^week:(\d{4}-\d{2}-\d{2})$/.exec(k || ""); if (m) return crRangeWeek(crD(m[1]));
  m = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(k || ""); if (m) return crRangeCustom(crD(m[1]), crD(m[2]));
  return null;
}
async function crLogoFromBytes(bytes, name) {
  const type = /\.png$/i.test(name) ? "image/png" : /\.webp$/i.test(name) ? "image/webp" : "image/jpeg";
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file is not an image Brahmastra can read.")); i.src = url; });
    const H = 160, scale = Math.min(1, H / img.naturalHeight), cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.naturalWidth * scale)); cv.height = Math.max(1, Math.round(img.naturalHeight * scale));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    let out = cv.toDataURL("image/png"); if (out.length > 270000) out = cv.toDataURL("image/jpeg", 0.85);
    return out;
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- Client 360 › Client report: build, edit, filter, present and print the client's report ---------- */
function crDefaultAnchor() { const t = new Date(); return t.getDate() <= 10 ? crAddM(t, -1) : crMS(t); }   // early in a month, last month's report
function ClientReportStudio({ ctx, me, go, clientId }) {
  const client = ctx.clients.find((c) => c.id === clientId) || {};
  const [ptype, setPtype] = useState("month");
  const [anchor, setAnchor] = useState(crDefaultAnchor);
  const [custom, setCustom] = useState(() => { const r = crRangeMonth(crDefaultAnchor()); return { from: crF.iso(r.start), to: crF.iso(r.end) }; });
  const range = useMemo(() => ptype === "week" ? crRangeWeek(anchor) : ptype === "custom" && crD(custom.from) && crD(custom.to) && custom.from <= custom.to ? crRangeCustom(crD(custom.from), crD(custom.to)) : crRangeMonth(anchor), [ptype, anchor, custom.from, custom.to]);
  const prevRange = crShift(range), periodKey = crPeriodKey(range);
  const [compare, setCompare] = useState(true);
  const [locId, setLocId] = useState("");
  useEffect(() => { setLocId(""); }, [clientId]);
  const q = useRpc("creport.get", { client_id: clientId, location_id: locId || undefined, from: crF.iso(range.start), to: crF.iso(range.end), prev_from: crF.iso(prevRange.start), prev_to: crF.iso(prevRange.end), period_key: periodKey },
    [clientId, locId, periodKey], !!clientId);
  const raw = q.data && q.data.client && q.data.client.id === clientId && q.data.period_key === periodKey ? q.data : null;
  const DS = useMemo(() => (raw ? crDatasets(raw) : null), [raw]);
  // the team's words on each page, saved a moment after a change
  const [edits, setEdits] = useState({});
  useEffect(() => { setEdits(raw ? raw.edits || {} : {}); }, [raw]);
  const [saved, setSaved] = useState(null);
  const timers = useRef({});
  const saveEd = (pid, data) => {
    setEdits((e) => ({ ...e, [pid]: data }));
    clearTimeout(timers.current[pid]);
    timers.current[pid] = setTimeout(async () => {
      const { _by, _at, ...clean } = data || {};
      try { const r = await rpc("creport.save", { client_id: clientId, location_id: locId || undefined, period_key: periodKey, page_id: pid, data: clean }); setSaved({ at: r.at, by: r.by }); }
      catch (e) { toast(e.message, "err"); }
    }, 600);
  };
  // the cross-filter (one set for every page, or one per page), the # / $ switch and the table view per chart
  const [sync, setSync] = useState(true);
  const [selAll, setSelAll] = useState({});
  const [page, setPage] = useState("exec");
  const selKey = sync ? "_all" : page, sel = selAll[selKey] || {};
  const setSel = (s) => setSelAll((a) => ({ ...a, [selKey]: s }));
  const toggleSel = (f, k, add) => {
    const cur = new Set((sel[f] && [...sel[f]]) || []);
    if (add) { cur.has(k) ? cur.delete(k) : cur.add(k); } else if (cur.size === 1 && cur.has(k)) cur.clear(); else { cur.clear(); cur.add(k); }
    const next = { ...sel }; if (cur.size) next[f] = cur; else delete next[f]; setSel(next);
  };
  useEffect(() => { setSelAll({}); }, [clientId, locId, periodKey]);
  const [cardMeasure, setCardMeasure] = useState({});
  const [tableView, setTableView] = useState({});
  const tools = { tableView, setMeasure: (id, m) => setCardMeasure((x) => ({ ...x, [id]: m })), setTable: (id) => setTableView((x) => ({ ...x, [id]: !x[id] })) };
  const canEdit = !!(raw && raw.can_edit);
  const [mode, setMode] = useState("edit");
  const viewMode = canEdit ? mode : "view";
  const [openSlicer, setOpenSlicer] = useState(null);
  const [claimId, setClaimId] = useState(null);
  const [present, setPresent] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const [logoOpen, setLogoOpen] = useState(false);
  // the start screen: the EV file and the dates first, then Create dashboard
  const [stage, setStage] = useState("setup");
  useEffect(() => { setStage("setup"); }, [clientId]);
  const [evOpen, setEvOpen] = useState(false);
  const [evDraft, setEvDraft] = useState(null);
  const [evBusy, setEvBusy] = useState(false);
  const locName = raw && locId ? ((raw.locations || []).find((l) => l.id === locId) || {}).name || "" : "";
  const nextName = range.kind === "month" ? CRM_L[crAddM(range.start, 1).getMonth()] : range.kind === "week" ? "next week" : "the next period";
  const R = useMemo(() => ({ range, compare, client: client.name || "", periodName: range.kind === "month" ? CRM_L[range.start.getMonth()] : crRangeLabel(range), cardMeasure }), [range, compare, client.name, cardMeasure]);
  const rep = { client: client.name || "", logo: raw ? raw.client.logo : "", locName, periodLabel: crRangeLabel(range), reportName: crPeriodWord(R) + " AR report", prevWord: crPrevWord(R), prepared: raw ? raw.prepared_by : me.name, nextName };
  const avail = DS ? CR_PAGES.map((p) => ({ ...p, has: crHasPage(DS, p.id) })) : [];
  const off = (edits._pages && edits._pages.off) || [];
  const included = avail.filter((p) => p.has && !off.includes(p.id));
  const buildModel = (pid, s) => { if (!DS) return null; const c = crCtx(DS, R, pid, s || {}); if (pid === "exec") return crBuildExec(c, raw); const p = CR_PAGE_BY[pid]; return p && p.build ? p.build(c) : null; };
  const model = useMemo(() => (page === "cover" ? null : buildModel(page, sel)), [DS, R, page, sel]);
  const ctxForSlice = DS ? crCtx(DS, R, page, {}) : null;
  const slice = ctxForSlice && page !== "cover" && page !== "exec" ? crSliceSource(ctxForSlice, page) : null;
  const filterText = (s) => Object.entries(s || {}).filter(([, v]) => v && v.size).map(([f, v]) => crDimLabel(null, f) + ": " + [...v].map((k) => DS ? crLabelAny(DS, f, k) : k).join(", ")).join(" · ");
  useEffect(() => { if (avail.length && !avail.some((p) => p.id === page && p.has)) setPage("exec"); }, [DS]);
  // hover tips and click-to-filter on the slide (Shift+click adds)
  const tipRef = useRef(null);
  const onSlideClick = (e) => { const el = e.target.closest && e.target.closest("[data-dim][data-key]"); if (!el || viewMode === "print") return; toggleSel(el.getAttribute("data-dim"), el.getAttribute("data-key"), e.shiftKey); };
  const onTip = (e) => { const tip = tipRef.current; if (!tip) return; const el = e.target.closest && e.target.closest("[data-tip]"); if (!el) { tip.style.display = "none"; return; }
    let d; try { d = JSON.parse(el.getAttribute("data-tip")); } catch (x) { return; }
    tip.innerHTML = `<b>${crEsc(d.t)}</b>` + (d.r || []).map(([k, v]) => `<div><span>${crEsc(k)}</span><em>${crEsc(v)}</em></div>`).join("");
    tip.style.display = "block"; const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 14, y = e.clientY + 14; if (x + w > window.innerWidth - 8) x = e.clientX - w - 14; if (y + h > window.innerHeight - 8) y = e.clientY - h - 14; tip.style.left = x + "px"; tip.style.top = y + "px"; };
  // the stage: the 1280 × 720 slide shrunk to the width there is
  const stageRef = useRef(null);
  const [stageW, setStageW] = useState(1000);
  useEffect(() => { const el = stageRef.current; if (!el || !window.ResizeObserver) return; const ro = new ResizeObserver(() => setStageW(Math.max(320, el.clientWidth - 32))); ro.observe(el); return () => ro.disconnect(); }, [!!raw]);
  const scale = Math.min(1, stageW / CR_W);
  const step = (n) => { if (ptype === "week") setAnchor((a) => crAddD(crWS(a), 7 * n)); else if (ptype === "month") setAnchor((a) => crAddM(crMS(a), n)); else { const r = crShift(range, n); setCustom({ from: crF.iso(r.start), to: crF.iso(r.end) }); } };
  const pIdx = included.findIndex((p) => p.id === page), numOf = (pid) => included.findIndex((p) => p.id === pid) + 1;
  const togglePdf = (pid) => saveEd("_pages", { off: off.includes(pid) ? off.filter((x) => x !== pid) : [...off, pid] });
  const docTitle = `${rep.client} - ${rep.reportName.replace(" AR report", " AR Report")} - ${rep.periodLabel}${locName ? " - " + locName : ""}`;
  const pickLogo = async ({ bytes, name }) => {
    try { const logo = await crLogoFromBytes(bytes, name); await rpc("clients.setLogo", { client_id: clientId, logo }); toast("Logo saved: it shows on the cover and every page."); setLogoOpen(false); q.reload(); }
    catch (e) { toast(e.message, "err"); }
  };
  const removeLogo = async () => {
    if (!window.confirm("Take the client's logo off the report? Its initials show instead.")) return;
    try { await rpc("clients.setLogo", { client_id: clientId, logo: "" }); toast("Logo removed."); q.reload(); } catch (e) { toast(e.message, "err"); }
  };
  if (!clientId) return <div className="card"><Empty>Pick a client.</Empty></div>;
  const periodControls = <>
    <div className="seg3">{[["month", "Monthly"], ["week", "Weekly"], ["custom", "Custom"]].map(([k, l]) => <button key={k} type="button" className={ptype === k ? "on" : ""} onClick={() => { setPtype(k); if (k !== "custom") setAnchor(range.end <= new Date() ? range.end : crDefaultAnchor()); }}>{l}</button>)}</div>
    {ptype === "custom" ? <span className="row" style={{ gap: 6 }}><input type="date" className="input sm" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /><span className="muted small">to</span><input type="date" className="input sm" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></span>
      : <span className="crx-per"><button type="button" onClick={() => step(-1)} title="Previous period">‹</button><b>{crRangeLabel(range)}</b><button type="button" onClick={() => step(1)} title="Next period">›</button></span>}
    <label className="crx-cmp" title={"Compare with the " + crPrevWord(R)}><input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare with {crRangeLabel(prevRange)}</label>
    {raw && (raw.locations || []).length > 1 && <select className="input sm" value={locId} onChange={(e) => setLocId(e.target.value)} style={{ width: 170 }}><option value="">All locations</option>{raw.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
  </>;
  const pickEV = async ({ bytes, name }) => { setEvOpen(false); try { setEvDraft(crReadEV(bytes, name)); } catch (e) { toast(e.message, "err"); } };
  const saveEV = async () => {
    setEvBusy(true);
    try { const x = await rpc("creport.evUpload", { client_id: clientId, location_id: locId || undefined, file_name: evDraft.file, rows: evDraft.rows });
      toast(`EV saved: ${crF.int(x.n)} rows, ${crF.date(crD(x.from))} to ${crF.date(crD(x.to))}.`); setEvDraft(null); q.reload(); }
    catch (e) { toast(e.message, "err"); }
    setEvBusy(false);
  };
  const removeEV = async (f) => {
    if (!window.confirm(`Remove ${f.file} (${crF.int(f.n)} EV rows) from ${client.name || "this client"}'s reports?`)) return;
    try { await rpc("creport.evRemove", { client_id: clientId, id: f.id }); toast("EV file removed."); q.reload(); } catch (e) { toast(e.message, "err"); }
  };
  const create = () => {
    setStage("dashboard"); setPage("exec");
    if (canEdit && raw && !(raw.edits || {})._made) rpc("creport.save", { client_id: clientId, location_id: locId || undefined, period_key: periodKey, page_id: "_made", data: { made: true } }).catch(() => {});
  };
  const openMade = (k) => { const x = crRangeFromKey(k); if (!x) return; setPtype(x.kind); if (x.kind === "custom") setCustom({ from: crF.iso(x.start), to: crF.iso(x.end) }); else setAnchor(x.start); setStage("dashboard"); setPage("exec"); };
  if (stage === "setup") {
    const evFiles = (raw && raw.ev_files) || [], made = ((raw && raw.made) || []).map((m) => ({ ...m, r: crRangeFromKey(m.period_key) })).filter((m) => m.r);
    const pageLine = (pid) => { if (!DS || !crHasPage(DS, pid)) return null; const m = buildModel(pid, {}); return m ? m.headline || m.title : null; };
    const inv = raw && raw.data && raw.data.inventory;
    const invNote = !inv ? "" : inv.source === "live" ? "today's inventory" : inv.source === "snapshot" ? "kept at " + crF.date(crD(inv.as_of)) : "rebuilt from the claims' history for " + crF.date(crD(inv.as_of));
    const SRC = [["submission", "Submission", "Submission desk"], ["rejection", "Rejections", "Rejections desk"], ["payment", "Payment posting", "Posting desk"], ["inventory", "AR inventory", "inventory uploads"], ["ar", "AR production", "billers' entries"], ["ca", "Client assistance", "requests to the client"]];
    return (
      <div className="stack crx crx-setup" style={{ gap: 12 }}>
        <div className="card"><div className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
          <div><h2 style={{ margin: 0 }}>New client report · {client.name}</h2><div className="sub">Add what Brahmastra does not have, pick the dates, then create the dashboard.</div></div>
          {made.length > 0 && <div className="small">Made before: {made.map((m, i) => <React.Fragment key={m.period_key}>{i ? " · " : ""}<button type="button" className="btn link" style={{ padding: 0, fontWeight: 700 }} onClick={() => openMade(m.period_key)}>{crRangeLabel(m.r)}</button></React.Fragment>)}</div>}
        </div></div>
        <div className="card"><div className="crx-step"><span className="crx-n">1</span><b>Data</b><span className="small muted">what goes into the dashboard for {crRangeLabel(range)}{locName ? " · " + locName : ""}</span></div>
          {q.error ? <ErrorBox error={q.error} /> : !raw ? <Spinner label="Reading Brahmastra for these dates…" /> : <div className="crx-src">
            <div className="crx-sec">Upload (Brahmastra does not do EV)</div>
            <span className="up">⬆</span><b>EV production</b><span className="from">from OneDrive</span>
            <div className="crx-evbox">
              {evFiles.map((f) => <div key={f.id} className="crx-file"><span>📄 <b>{f.file}</b></span><span className="badge green">{crF.int(f.n)} rows · {crF.dateShort(crD(f.from))} to {crF.date(crD(f.to))}</span>
                <span className="tiny muted">{f.by} · {fmtWhen(f.at)}{locId && f.all_locations ? " · for all locations" : ""}</span>{canEdit && <button type="button" className="btn sm link" onClick={() => removeEV(f)}>Remove</button>}</div>)}
              {evDraft && (evDraft.noDate
                ? <div className="alert err" style={{ margin: 0 }}><b>{evDraft.file}:</b> Brahmastra could not find the date each check was done (a column such as Date, Work date or Verified on). Add that column and pick the file again.
                    <div className="row" style={{ marginTop: 6 }}><button type="button" className="btn sm" onClick={() => setEvDraft(null)}>OK</button></div></div>
                : <div className="crx-file draft"><span>📄 <b>{evDraft.file}</b></span><span className="badge blue">{crF.int(evDraft.n)} rows · {crF.dateShort(crD(evDraft.from))} to {crF.date(crD(evDraft.to))}</span>
                    <span className="tiny muted" style={{ flexBasis: "100%" }}>Columns found: {evDraft.found.map(([l, h]) => l + (l.toLowerCase() === h.toLowerCase() ? "" : " (" + h + ")")).join(", ")}{evDraft.skipped ? ` · ${crF.int(evDraft.skipped)} rows without a date left out` : ""}. Patient names are not read.</span>
                    <button type="button" className="btn primary sm" disabled={evBusy} onClick={saveEV}>{evBusy ? "Saving…" : "Save to the report"}</button><button type="button" className="btn sm" disabled={evBusy} onClick={() => setEvDraft(null)}>Cancel</button></div>)}
              {!evFiles.length && !evDraft && <span className="small muted">No EV file covers these dates yet; the EV page is left out until one is added.</span>}
              {canEdit && !evDraft && <div><button type="button" className="btn sm" onClick={() => setEvOpen(true)}>{evFiles.length ? "Add or replace from OneDrive" : "Upload EV from OneDrive"}</button></div>}
            </div>
            <div className="crx-sec">From Brahmastra (nothing to upload)</div>
            {SRC.map(([pid, l, from]) => { const line = pageLine(pid); return <React.Fragment key={pid}><span className={line ? "ok" : "no"}>{line ? "✓" : "–"}</span><b>{l}</b><span className="from">{from}</span>
              <span>{line || <span className="muted">nothing in these dates; the page is left out</span>}{pid === "inventory" && line && invNote ? <span className="tiny muted"> · {invNote}</span> : null}</span></React.Fragment>; })}
          </div>}
        </div>
        <div className="card"><div className="crx-step"><span className="crx-n">2</span><b>Dates</b></div><div className="row" style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}>{periodControls}</div></div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}><span className="small muted" style={{ alignSelf: "center" }}>Opens the dashboard: every page, filters, edits, Present and the PDF</span>
          <button type="button" className="btn primary lg crx-create" disabled={!raw} onClick={create}>Create dashboard →</button></div>
        {evOpen && <OneDrivePicker folderLink={client.od && client.od.link} onClose={() => setEvOpen(false)} onPick={pickEV} />}
      </div>
    );
  }
  const slideFor = (pid, s, m) => pid === "cover" ? <CrCover rep={rep} pages={included} mode={m} /> : <CrSlide page={CR_PAGE_BY[pid]} model={pid === page && s === sel ? model : buildModel(pid, s)} rep={rep} n={numOf(pid) || 1} total={included.length || 1}
    mode={m} ed={edits[pid]} onEd={(d) => saveEd(pid, d)} tools={tools} filterText={filterText(s)} />;
  return (
    <div className="stack crx" style={{ gap: 12 }}>
      <div className="card crx-bar">
        <b className="crx-made">{crRangeLabel(range)}</b>
        <span className="muted small">{compare ? "compared with " + crRangeLabel(prevRange) : "no comparison"}{locName ? " · " + locName : ""}{DS && DS.ev ? " · EV from the uploaded file" : ""}</span>
        <button type="button" className="btn sm" onClick={() => setStage("setup")}>Change data or dates</button>
        <span style={{ flex: 1 }} />
        {canEdit && <div className="seg3"><button type="button" className={mode === "edit" ? "on" : ""} onClick={() => setMode("edit")}>✎ Edit</button><button type="button" className={mode === "view" ? "on" : ""} onClick={() => setMode("view")}>👁 View as client</button></div>}
        <button className="btn" disabled={!raw} title="Every ticked page, the full picture (no filters), one widescreen page per slide" onClick={() => setPrintJob({ sel: {}, pages: included.map((p) => p.id) })}>⬇ Download PDF</button>
        {Object.keys(sel).length > 0 && <button className="btn" disabled={!raw} title="Every ticked page with the filters you have set" onClick={() => setPrintJob({ sel, pages: included.map((p) => p.id) })}>⬇ PDF of this view</button>}
        <button className="btn primary" disabled={!raw || !included.length} onClick={() => setPresent({ idx: Math.max(0, pIdx) })}>▶ Present</button>
      </div>
      {q.error ? <ErrorBox error={q.error} /> : !raw ? <div className="card"><Spinner label="Building the report from Brahmastra…" /></div> : <>
        {page !== "cover" && page !== "exec" && <div className="card crx-fbar">
          {(model && model.slicers || []).map((f) => { const n = sel[f] ? sel[f].size : 0; return <span key={f} className="crx-slc-w"><button type="button" className={"crx-slc" + (n ? " on" : "")} onClick={() => setOpenSlicer(openSlicer === f ? null : f)}>{crDimLabel(null, f)} {n ? <span className="c">{n}</span> : "▾"}</button>
            {openSlicer === f && slice && <div className="crx-menu" onMouseLeave={() => setOpenSlicer(null)}>{crAgg(slice.rows, f, slice.ds, { measure: "count" }).slice(0, 40).map((it) => <label key={it.key} className="check small"><input type="checkbox" checked={!!(sel[f] && sel[f].has(it.key))} onChange={() => toggleSel(f, it.key, true)} /> {it.label} <span className="muted">· {crF.int(it.count)}</span></label>)}</div>}</span>; })}
          {Object.entries(sel).map(([f, v]) => [...v].map((k) => <span key={f + k} className="crx-chip">{crDimLabel(null, f)}: {crLabelAny(DS, f, k)} <button type="button" onClick={() => toggleSel(f, k, true)}>✕</button></span>))}
          {Object.keys(sel).length > 0 && <button type="button" className="btn sm link" onClick={() => setSel({})}>Clear all</button>}
          <span style={{ flex: 1 }} /><label className="crx-cmp small"><input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Same filters on every page</label><span className="tiny muted">Click a bar to filter · Shift+click to add</span>
        </div>}
        <div className="crx-studio">
          <div className="card crx-rail"><div className="crx-rh"><span>Pages</span><span>In PDF</span></div>
            {avail.map((p) => <div key={p.id} className={"crx-ri" + (page === p.id ? " on" : "") + (p.has ? "" : " dim")} onClick={() => p.has && setPage(p.id)}>
              <span className="th" /><span className="nm">{p.title}{!p.has && <small>no data in this period</small>}</span>
              {p.has && <button type="button" className={"ck" + (off.includes(p.id) ? " off" : "")} disabled={!canEdit} title={off.includes(p.id) ? "Left out of the PDF and Present" : "In the PDF and Present"} onClick={(e) => { e.stopPropagation(); togglePdf(p.id); }}>{off.includes(p.id) ? "" : "✓"}</button>}</div>)}
            {canEdit && <button type="button" className="btn sm" style={{ marginTop: 10, width: "100%" }} onClick={() => setLogoOpen(true)}>{raw.client.logo ? "Change the client's logo" : "Add the client's logo"}</button>}
            {canEdit && raw.client.logo && <button type="button" className="btn sm link" style={{ width: "100%" }} onClick={removeLogo}>Remove the logo</button>}
          </div>
          <div className="card crx-stage" ref={stageRef} onMouseMove={onTip} onMouseLeave={() => { if (tipRef.current) tipRef.current.style.display = "none"; }}>
            <div className="crx-wrap" style={{ width: CR_W * scale, height: CR_H * scale }} onClick={onSlideClick}><div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: CR_W, height: CR_H }}>{slideFor(page, sel, viewMode)}</div></div>
            <div className="crx-note"><span>{viewMode === "edit" ? "✎ Click the title, an insight, the RCA or a list line to change it; ✕ drops it. Saved for " + rep.client + " · " + rep.periodLabel + ", shared with your team." : "This is the page as the client sees it."}{saved ? " Saved " + new Date(saved.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + "." : ""}</span>
              <span>{pIdx >= 0 ? `Page ${pIdx + 1} of ${included.length}` : "Left out of the PDF"}</span></div>
          </div>
        </div>
        {model && model.claims && <CrClaims spec={model.claims.rows.length || !(DS.inventory && DS.inventory.cells) ? model.claims : { ...model.claims, note: "This inventory is a kept summary; Claims has today's claim list." }} ctx={ctx} me={me} title={rep.client + " - " + model.title + " - " + rep.periodLabel} onOpen={setClaimId} />}
      </>}
      <div ref={tipRef} className="crx-tip" />
      {claimId && <ClaimDrawer id={claimId} ctx={ctx} me={me} onClose={() => setClaimId(null)} onChanged={() => q.reload()} />}
      {logoOpen && <OneDrivePicker folderLink={client.od && client.od.link} accept={(n) => /\.(png|jpe?g|webp)$/i.test(n || "")} what="image" onClose={() => setLogoOpen(false)} onPick={pickLogo} />}
      {present && raw && <CrPresent pages={included} start={present.idx} slideFor={(pid) => slideFor(pid, sel, "present")} onClose={() => setPresent(null)} onSlideClick={onSlideClick} onClear={() => setSel({})} />}
      {printJob && raw && <CrPrintJob title={docTitle} pages={printJob.pages} slideFor={(pid) => slideFor(pid, printJob.sel, "print")} onDone={() => setPrintJob(null)} />}
    </div>
  );
}
const crLabelAny = (DS, f, k) => { for (const role of ["inventory", "worked", "payment", "submission", "rejection", "clientAssistance"]) { const d = DS[role]; if (d && d.recs.some((r) => String(r[f]) === k)) return crLabelOf(d, f, k); } return k || "(blank)"; };
/* Present: the ticked pages full screen; ← → move, click a bar to filter, C clears, Esc leaves */
function CrPresent({ pages, start, slideFor, onClose, onSlideClick, onClear }) {
  const [i, setI] = useState(Math.min(start, pages.length - 1));
  const [vw, setVw] = useState({ w: window.innerWidth, h: window.innerHeight });
  const ref = useRef(null);
  useEffect(() => {
    const key = (e) => { if (e.key === "Escape") onClose(); else if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); setI((x) => Math.min(pages.length - 1, x + 1)); } else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } else if (e.key === "c" || e.key === "C") onClear(); };
    const rs = () => setVw({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("keydown", key); window.addEventListener("resize", rs);
    try { if (ref.current && ref.current.requestFullscreen) ref.current.requestFullscreen().catch(() => {}); } catch (e) {}
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("resize", rs); try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {} };
  }, []);
  useEffect(() => { const f = () => { if (!document.fullscreenElement) setVw({ w: window.innerWidth, h: window.innerHeight }); }; document.addEventListener("fullscreenchange", f); return () => document.removeEventListener("fullscreenchange", f); }, []);
  const s = Math.min((vw.w - 32) / CR_W, (vw.h - 70) / CR_H), p = pages[i];
  return ReactDOM.createPortal(<div className="crx-present" ref={ref}>
    <div className="crx-pw" style={{ width: CR_W * s, height: CR_H * s }} onClick={onSlideClick}><div style={{ transform: `scale(${s})`, transformOrigin: "top left", width: CR_W, height: CR_H }}>{p && slideFor(p.id)}</div></div>
    <div className="crx-pctl"><button type="button" onClick={() => setI(Math.max(0, i - 1))}>‹</button><b>{i + 1}</b><span>/ {pages.length}</span><button type="button" onClick={() => setI(Math.min(pages.length - 1, i + 1))}>›</button>
      <span className="sep">|</span><span>← → page · click a bar to filter · C clears · Esc leaves</span><button type="button" onClick={onClose}>✕</button></div>
  </div>, document.body);
}
/* the PDF: every page as one widescreen sheet (13.33 × 7.5 in), through the browser's Save as PDF */
function CrPrintJob({ title, pages, slideFor, onDone }) {
  useEffect(() => {
    const st = document.createElement("style"); st.id = "crPageSize"; st.textContent = "@page { size: 1280px 720px; margin: 0 }"; document.head.appendChild(st);
    const oldTitle = document.title; document.title = title; document.body.classList.add("cr-printing");
    let done = false;
    const finish = () => { if (done) return; done = true; document.body.classList.remove("cr-printing"); document.title = oldTitle; st.remove(); onDone(); };
    window.addEventListener("afterprint", finish);
    // (the browser checks hold the page open to print it to a file themselves: window.__crHoldPrint)
    const t = setTimeout(() => { try { window.print(); } catch (e) {} if (window.__crHoldPrint) window.__crPrintDone = finish; else setTimeout(finish, 800); }, 700);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", finish); if (!done) { document.body.classList.remove("cr-printing"); document.title = oldTitle; st.remove(); } };
  }, []);
  return ReactDOM.createPortal(<div id="crPrint">{pages.map((pid) => <div key={pid} className="crx-pp">{slideFor(pid)}</div>)}</div>, document.body);
}

/* Drishti opens already signed in as the Brahmastra user: Brahmastra asks its server for Drishti's own session token
   and leaves it where the Drishti page looks for it (same web address, so the same browser storage). */
const DRISHTI_TOKEN_KEY = "drishti:token:v1";
/* The SLA tab's heading, with Drishti's frame buttons (load again, own browser tab, full screen) while a Drishti tab is open. */
function SlaHead({ title, sub, onHow, frame }) {
  const stamp = new Date().toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="row between top" style={{ marginBottom: 12, flexWrap: "nowrap", gap: 16 }}>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}><h1>{title}</h1><div className="sub">{sub}</div></div>
      <div className="rh-acts" style={{ alignItems: "center", flex: "0 0 auto" }}>
        <span className="small muted">{stamp}</span>
        <button className="btn" onClick={onHow}><Ico d={HUB_ICONS.info} size={15} /> How it works</button>
        {frame && <>
          <button className="btn icon" title="Load again" onClick={frame.reload}><Ico d={HUB_ICONS.reload} size={15} /></button>
          <button className="btn icon" title="Open Drishti in its own browser tab (use this if a Microsoft sign-in window does not open here)" onClick={() => window.open(frame.src, "_blank", "noopener")}><Ico d={HUB_ICONS.ext} size={15} /></button>
          <button className="btn icon" title="Full screen" onClick={() => frame.setFull(true)}><Ico d={HUB_ICONS.full} size={15} /></button>
        </>}
      </div>
    </div>
  );
}
function SlaPage({ ctx, me, onHow, title, sub, more, pick, setPick, children }) {
  const [sso, setSso] = useState({ state: "loading" });
  useEffect(() => {
    let alive = true;
    rpc("reports.drishtiSession").then((r) => {
      try { localStorage.setItem(DRISHTI_TOKEN_KEY, r.token); } catch (e) {}
      if (alive) setSso({ state: "ok", name: r.name, role: r.role, created: r.created });
    }).catch((e) => { if (alive) setSso({ state: e.status === 503 && /not switched on/.test(e.message) ? "off" : "error", msg: e.message }); });
    return () => { alive = false; };
  }, []);
  const frameRef = useRef(null);
  const frame = useFrame(DR_BASE);
  const [f, setF] = useState({ client_id: onlyClient(ctx), location_id: "" });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [fed, setFed] = useState(null);
  const client = ctx.clients.find((c) => c.id === f.client_id);
  const rc = useReportsContext(me, client);
  /* When a client's upload page is open in the scorecard, Brahmastra adds that client's AR Inventory to it by itself
     (the same report Save AR Inventory to OneDrive writes). Drishti matches it to its slot and shows it for review
     before anything is calculated; a file chosen there afterwards replaces it. */
  const fedZones = useRef(new WeakSet());
  const fState = useRef(f); fState.current = f;
  useEffect(() => {
    if (frame.loading) return;
    let alive = true, working = false;
    const tick = async () => {
      if (!alive || working) return;
      const win = frame.win.current && frame.win.current.contentWindow;
      let doc = null; try { doc = win && win.document; } catch (e) { doc = null; }
      const zone = doc && doc.querySelector(".bulkzone");
      if (!zone || fedZones.current.has(zone)) return;
      const up = drishtiProps(zone, (p) => typeof p.onFiles === "function");
      if (!up || up.busy) return;
      if (!/AR Inventory/i.test((zone.closest(".wrap") || doc.body).innerText || "")) { fedZones.current.add(zone); return; }
      // The client's name is the page heading above the upload area ("Sunrise Eye Care").
      const head = (zone.closest(".wrap") || doc.body).querySelector("h1");
      const dName = head ? head.textContent.trim() : "";
      const match = dName ? matchClient(ctx.clients, dName) : null;
      const cid = (match && match.id) || fState.current.client_id;
      if (!cid) { setFed({ state: "pick", dName }); return; }
      const cl = ctx.clients.find((c) => c.id === cid);
      if (match && match.id !== fState.current.client_id) setF((x) => ({ ...x, client_id: match.id, location_id: "" }));
      working = true; fedZones.current.add(zone);
      try {
        const r = await rpc("reports.arInventory", { client_id: cid, location_id: (!match || match.id === fState.current.client_id) && fState.current.location_id ? fState.current.location_id : undefined });
        if (!alive) return;
        if (!r.rows.length) { setFed({ state: "none", client: cl.name, dName }); return; }
        const b = xlsxBlob(r.header, r.rows, "AR Inventory");
        const name = safeName("AR Inventory report - " + cl.name + " - " + todayISO()) + ".xlsx";
        up.onFiles([new win.File([b], name, { type: b.type })]);
        setFed({ state: "ok", n: r.rows.length, client: cl.name, dName: dName || cl.name, at: timeNow() });
        rpc("monthend.mark", { client_id: cid, step: "sla_inventory" }).catch(() => {});
      } catch (e) { fedZones.current.delete(zone); setFed({ state: "error", msg: e.message }); }
      working = false;
    };
    const id = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(id); };
  }, [frame.loading, frame.nonce]);
  const saveInv = async () => {
    setBusy(true); setSaved(null);
    try {
      const r = await rpc("reports.arInventory", { client_id: f.client_id, location_id: f.location_id || undefined });
      if (!r.rows.length) { toast("This client has no open AR in Brahmastra right now.", "err"); setBusy(false); return; }
      const name = safeName(`AR Inventory report - ${client.name} - ${todayISO()}`);
      const s = await rpc("reports.saveArInventory", { client_id: f.client_id, name, file_b64: XLSX.write(xlsxBook(r.header, r.rows, "AR Inventory"), { bookType: "xlsx", type: "base64" }) });
      setSaved({ n: r.rows.length, name: s.name, folders: s.folders, at: timeNow() });
    } catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  return (
    <div>
      <SlaHead title={title} sub={sub} onHow={onHow} frame={pick == null && sso.state !== "loading" ? frame : null} />
      {pick == null && <><div className="card rh-bar">
        <ClientPicker ctx={ctx} clientId={f.client_id} setClientId={(v) => { setF({ client_id: v, location_id: "" }); setSaved(null); }} locId={f.location_id} setLocId={(v) => setF((x) => ({ ...x, location_id: v }))} />
        <button className="btn rh-go" disabled={!f.client_id || busy} onClick={saveInv} title="Today's AR inventory, in the columns the scorecard's AR Inventory report reads">{busy ? "Saving…" : "Save AR Inventory to OneDrive"}</button>
        <div className="rh-signed">{sso.state === "ok" ? <><i className="rh-dot" />Signed in as {sso.name}</> : sso.state === "loading" ? <><i className="rh-dot wait" />Signing you in…</> : <><i className="rh-dot wait" />Sign in below</>}</div>
      </div>
      <div className="rh-status">
        {saved ? <span><i className="rh-dot" />{saved.name} · {fmtInt(saved.n)} claims · saved {saved.at} to {saved.folders.join(" and ")}</span>
          : <span><i className="rh-dot off" />{f.client_id ? "AR Inventory goes to " + rc.folder("SLA & KPI") : "Pick a client to put its AR Inventory report in OneDrive"}</span>}
        <span>Then below: Upload from OneDrive, and pick it with the period's other files</span>
      </div>
      {fed && fed.state === "ok" && <div className="alert info mb rh-note"><b>Already added from Brahmastra.</b> Today's AR Inventory for {fed.client} ({fmtInt(fed.n)} claims, {fed.at}) is in {fed.dName}'s uploads below, matched to its slot for you to check before anything is calculated. To use a different file, upload it in the same box and it takes its place.</div>}
      {fed && fed.state === "pick" && <div className="alert warn mb rh-note">{fed.dName ? <><b>{fed.dName}</b> is not a Brahmastra client name I can match.</> : null} Pick its client above and its AR Inventory goes into the uploads below by itself.</div>}
      {fed && fed.state === "none" && <div className="alert info mb rh-note">{fed.client} has no open AR in Brahmastra today, so nothing was added. Upload the AR Inventory below if you have it.</div>}
      {fed && fed.state === "error" && <div className="alert warn mb rh-note">The AR Inventory could not be added by itself: {fed.msg}</div>}
      {sso.state === "ok" && sso.created && <div className="alert info mb">Your scorecard account was made from your Brahmastra profile, under your reporting manager. From now on it opens signed in.</div>}
      {sso.state === "off" && <div className="alert info mb">The scorecard will open signed in once single sign-in is switched on (a one-time setting). Until then, sign in below.</div>}
      {sso.state === "error" && <div className="alert warn mb"><b>Drishti could not be opened signed in.</b> {sso.msg} You can still sign in below.</div>}</>}
      <EmbedPanel frame={frame} frameRef={frameRef} title="Drishti" ready={sso.state !== "loading"} waitLabel="Signing you in…" more={more} pick={pick} setPick={setPick}>{children}</EmbedPanel>
    </div>
  );
}
/* Team allocations: each allocated claim with, right beside it, the work done on it in the period. What is still
   waiting is flagged, so allocation and activity are read as one list. */
const DESK_SHOW = [["all", "All"], ["waiting", "Not worked yet"], ["worked", "Worked"], ["closed", "Closed"]];
function deskStatus(r, today) {
  if (r.state === "closed") return { k: "closed", label: "Closed", tone: "green" };
  if (r.entries) return r.kind === "skip" ? { k: "worked", label: "Skipped", tone: "gray" } : { k: "worked", label: r.state === "completed" ? "Worked, follow-up set" : "Worked", tone: "teal" };
  if (r.state === "completed" && r.follow_up_on && r.follow_up_on < today) return { k: "waiting", label: "Follow-up overdue", tone: "red" };
  if (r.state === "completed" && r.follow_up_on && r.follow_up_on > today) return { k: "later", label: "Follow-up " + fmtDate(r.follow_up_on), tone: "gray" };
  return { k: "waiting", label: "Not worked yet", tone: "amber" };
}
function TeamDesk({ ctx, from, to, rangeLabel, fixedUser }) {
  const [f, setF] = useState({ client_id: "", location_id: "", user_id: fixedUser || "", show: "all" });
  const payload = { client_id: f.client_id || undefined, location_id: f.location_id || undefined, user_id: f.user_id || undefined, from_ms: dayBounds(from)[0], to_ms: dayBounds(to)[1] };
  const q = useRpc("reports.desk", payload, [JSON.stringify(payload)]);
  const today = (q.data && q.data.today) || todayISO();
  const all = useMemo(() => (q.data ? q.data.rows : []).map((r) => ({ ...r, st: deskStatus(r, today), who: r.assigned_name || r.by_name || "Not allocated" })), [q.data]);
  const sort = useTableSort("who", "asc");
  const rows = sort.sortRows(all.filter((r) => f.show === "all" || r.st.k === f.show || (f.show === "waiting" && r.st.k === "waiting")));
  const count = (k) => all.filter((r) => r.st.k === k).length;
  const people = useMemo(() => {
    const m = new Map();
    for (const r of all) { if (!r.assigned_to && !r.by_id) continue; const k = r.who; const p = m.get(k) || { name: k, id: r.assigned_to || r.by_id, alloc: 0, worked: 0, waiting: 0 }; if (r.assigned_to) p.alloc++; if (r.st.k === "worked" || (r.st.k === "closed" && r.entries)) p.worked++; if (r.st.k === "waiting") p.waiting++; m.set(k, p); }
    return [...m.values()].sort((a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name));
  }, [all]);
  const csv = () => downloadText(toCSV(rows.map((r) => ({ Biller: r.who, Client: r.client_name + (r.location_name ? " · " + r.location_name : ""), "Claim #": r.claim_no, Patient: r.patient, Payer: r.payer, Balance: r.balance, Priority: r.priority,
    Allocated: r.assigned_at ? new Date(r.assigned_at).toLocaleString() : "", "Work done": r.st.label, Entries: r.entries || 0, "SAAG status": r.status || "", Action: r.action || "", Bucket: r.work_bucket || "", Note: r.comment || "",
    "Worked by": r.by_name || "", "Worked at": r.last_at ? new Date(r.last_at).toLocaleString() : "", "Next follow-up": r.next_follow_up || r.follow_up_on || "" })),
    ["Biller", "Client", "Claim #", "Patient", "Payer", "Balance", "Priority", "Allocated", "Work done", "Entries", "SAAG status", "Action", "Bucket", "Note", "Worked by", "Worked at", "Next follow-up"].map((h) => ({ label: h, key: h }))), `team-allocations-${from}-to-${to}.csv`);
  return (
    <div className="stack">
      <div className="grid g4">
        <Kpi label="On desks" value={fmtInt(all.filter((r) => r.assigned_to && r.state !== "closed").length)} sub={"allocated, " + rangeLabel} tone="accent" />
        <Kpi label="Worked" value={fmtInt(count("worked"))} sub={fmtInt(all.reduce((n, r) => n + (r.entries || 0), 0)) + " entries"} tone="good" />
        <Kpi label="Not worked yet" value={fmtInt(count("waiting"))} sub={all.filter((r) => r.st.label === "Follow-up overdue").length + " with the follow-up overdue"} tone={count("waiting") ? "warn" : undefined} />
        <Kpi label="Closed" value={fmtInt(count("closed"))} sub="resolved in the period" />
      </div>
      {people.length > 0 && <div className="card tight"><div className="desk-people">{people.map((p) => {
        const done = p.alloc ? Math.min(100, Math.round(100 * p.worked / Math.max(p.alloc, p.worked))) : 100;
        return <button key={p.name} type="button" className={"desk-person" + (f.user_id === p.id ? " on" : "")} onClick={() => setF({ ...f, user_id: f.user_id === p.id ? "" : p.id })}>
          <span className="nm">{p.name}</span><span className="bar"><i style={{ width: done + "%" }} /></span>
          <span className="small muted">{p.worked} worked of {p.alloc || p.worked}{p.waiting ? <b style={{ color: "var(--amber-ink)" }}> · {p.waiting} waiting</b> : null}</span></button>; })}</div></div>}
      <div className="card tight row" style={{ alignItems: "flex-end", gap: 10 }}>
        <ClientPicker ctx={ctx} clientId={f.client_id} setClientId={(v) => setF({ ...f, client_id: v, location_id: "" })} locId={f.location_id} setLocId={(v) => setF({ ...f, location_id: v })} allowAll />
        {!fixedUser && <Field label="Biller"><Combo value={f.user_id} onChange={(v) => setF({ ...f, user_id: v })} placeholder="Everyone" options={[{ id: "", label: "Everyone" }, ...ctx.users.filter((u) => u.active).map((u) => ({ id: u.id, label: u.name, sub: u.designation || undefined }))]} /></Field>}
        <Field label="Show"><div className="seg2">{DESK_SHOW.map(([k, l]) => <button key={k} className={f.show === k ? "on" : ""} onClick={() => setF({ ...f, show: k })}>{l}{k !== "all" ? " " + count(k) : ""}</button>)}</div></Field>
        <button className="btn" style={{ marginLeft: "auto" }} disabled={!rows.length} onClick={csv}>Download CSV</button>
      </div>
      <ErrorBox error={q.error} />
      <div className="card tight">
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap" style={{ maxHeight: 640 }}><table className="t desk"><thead><tr>
          {sort.Th("who", "Biller")}{sort.Th("claim_no", "Claim")}{sort.Th("client_name", "Client")}{sort.Th("payer", "Payer")}{sort.Th("balance", "Balance", "r")}{sort.Th("assigned_at", "Allocated")}
          <th className="desk-split">Work done {rangeLabel}</th>{sort.Th("next_follow_up", "Next follow-up")}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r.claim_id} className={r.st.k === "waiting" ? "desk-wait" : ""}>
            <td className="small"><b>{r.who}</b></td>
            <td><span className="mono small">{r.claim_no || r.account_no || "–"}</span><div className="tiny muted">{r.patient}</div></td>
            <td className="small">{r.client_name}{r.location_name ? <div className="tiny muted">{r.location_name}</div> : null}</td>
            <td className="small">{r.payer}</td><td className="num">{fmtMoney(r.balance)}</td>
            <td className="small">{r.assigned_at ? fmtWhen(r.assigned_at) : <span className="muted">–</span>}</td>
            <td className="desk-split small" style={{ minWidth: 300 }}>
              <span className={"badge " + r.st.tone}>{r.st.label}</span>{r.escalated ? <span className="badge red" style={{ marginLeft: 4 }}>escalated</span> : null}
              {r.entries ? <><div style={{ marginTop: 4 }}><b>{[r.status, r.sub_status].filter(Boolean).join(" · ") || r.kind}</b>{r.action ? " → " + r.action : ""}{r.work_bucket ? <span className="tiny muted"> · {r.work_bucket}</span> : null}</div>
                {r.comment ? <div className="desk-note" title={r.comment}>{r.comment}</div> : null}
                <div className="tiny muted">{r.by_name} · {fmtWhen(r.last_at)}{r.entries > 1 ? ` · ${r.entries} entries` : ""}</div></> : null}
            </td>
            <td className="small">{r.next_follow_up || r.follow_up_on ? fmtDate(r.next_follow_up || r.follow_up_on) : "–"}</td></tr>)}
            {q.data && !rows.length && <tr><td colSpan={8}><Empty>{all.length ? "Nothing for this filter." : "Nothing allocated or worked in this period."}</Empty></td></tr>}</tbody></table></div>
      </div>
    </div>
  );
}
/* Props of the nearest React component above an element inside the scorecard page (same web address) that passes test. */
function drishtiProps(el, test) {
  try {
    const k = Object.keys(el).find((x) => x.startsWith("__reactFiber$"));
    for (let fb = k && el[k], i = 0; fb && i < 60; fb = fb.return, i++) { const p = fb.memoizedProps; if (p && typeof p === "object" && test(p)) return p; }
  } catch (e) {}
  return null;
}
/* A Brahmastra client whose name matches another app's client name (case, spaces and punctuation ignored). */
function matchClient(clients, name) {
  const k = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""), want = k(name);
  if (!want) return null;
  const act = (clients || []).filter((c) => c.active);
  return act.find((c) => k(c.name) === want) || act.find((c) => (c.roster_names || []).some((r) => k(r) === want))
    || act.find((c) => want.length >= 5 && (k(c.name).includes(want) || want.includes(k(c.name)))) || null;
}
/* The client to start on: the only active one someone has, else none. */
const onlyClient = (ctx) => { const a = (ctx.clients || []).filter((c) => c.active); return a.length === 1 ? a[0].id : ""; };
/* Sasha's Third Eye has its own tab beside SLA: the internal reports (QA, production, insights). The client report lives
   in Client 360 now, next to everything else about that client. Posting and Submission leads get their own scope only. */
const DESK_TE_SCOPE = { posting: ["pp"], submission: ["sub"], both: ["pp", "sub"] };
function ThirdEyeView({ ctx, me }) {
  const desk = deskOf(me, null);
  const [how, setHow] = useState(false);
  return (
    <div>
      <QualityPage key="q" ctx={ctx} me={me} onHow={() => setHow(true)} lockScope={desk ? DESK_TE_SCOPE[desk] : null} />
      {how && <HowDrawer page="quality" onClose={() => setHow(false)} />}
    </div>
  );
}
/* SLA has its own tab in front of Dashboard, so the scorecard is one click away all day. */
/* The SLA tab reads as one embedded app, like Sasha's Third Eye: Drishti's own tabs (Overview, Clients, Formulas...)
   in Brahmastra's tab row and Brahmastra's theme, with two tabs of Brahmastra's own beside them: the SLA scorecard in
   Client 360's style and the Monday digest. */
const SLA_OWN = [["scorecard", "SLA scorecard"], ["digest", "Monday digest"]];
function SlaView(props) {
  const { params, me, ctx } = props;
  const own = (x) => (x && SLA_OWN.some(([k]) => k === x.tab) ? x.tab : null);
  const [pick, setPick] = useState(() => own(params));
  const [scClient, setScClient] = useState((params && params.client_id) || "");
  useEffect(() => { if (params && params.tab) setPick(own(params)); if (params && params.client_id) setScClient(params.client_id); }, [params && params.tab, params && params.client_id]);
  const [how, setHow] = useState(false);
  const SUB = { drishti: "Drishti, signed in as you: the overview, each client's uploads and figures, the formulas. Upload the period's reports or type a value here.",
    scorecard: "Did we meet what each client signed for? Drishti's scorecard for the client and period, in one page.",
    digest: "One email per manager's span, every Monday morning, to the manager and the supervisors on those clients." };
  return (
    <div className="stack">
      <SlaPage ctx={ctx} me={me} onHow={() => setHow(true)} title="SLA" sub={SUB[pick || "drishti"]} more={SLA_OWN.map(([id, label]) => ({ id, label }))} pick={pick} setPick={setPick}>
        {pick === "scorecard" ? <SlaScorecard {...props} clientId={scClient} setClientId={setScClient} openInputs={() => setPick(null)} /> : pick === "digest" ? <DigestSpans me={me} /> : null}
      </SlaPage>
      {how && <HowDrawer page="sla" onClose={() => setHow(false)} />}
    </div>
  );
}
/* The SLA scorecard, in Client 360's style: Drishti's figures and rules, read by Brahmastra (nothing in Drishti changes).
   The period picked (the latest month unless asked), the score with its band, the scopes, what pulls it down, the
   strengths, the score by period, where the figures come from, and every KPI with its formula. */
const PSLA_KIND = [["latest", "Latest"], ["month", "Monthly"], ["week", "Weekly"]];
const SLA_COLS = [{ key: "scope", label: "Scope" }, { key: "name", label: "KPI" }, { key: "shown", label: "Value" }, { key: "target", label: "Standard" }, { key: "formula", label: "Formula" },
  { key: "status", label: "Status", get: (x) => (x.status === "ok" ? "Green" : x.status === "warn" ? "Amber" : x.status === "miss" ? "Red" : "Info") }, { key: "source", label: "From" }, { key: "reason", label: "Comment" }, { key: "std", label: "Drishti's standard" }];
/* Where a KPI's value sits on its bar, and the green target zone: lower is better, higher is better, or a range. */
function kpiBar(it) {
  const r = it.rule, v = it.value;
  // only a scored number is drawn: an empty value or text Drishti did not score has no place on the bar
  if (!r || typeof v !== "number" || !isFinite(v) || !["ok", "warn", "miss"].includes(it.status)) return null;
  const pct = r.fmt === "percent";
  let lo = 0, hi, z0, z1;
  if (r.dir === "lower") { hi = Math.max(v, (r.fair || r.good) * 1.5, r.good * 2, pct ? 0.05 : 1) * 1.1; z0 = 0; z1 = r.good; }
  else if (r.dir === "higher") { hi = pct ? 1 : Math.max(v, r.good) * 1.25; z0 = r.good; z1 = hi; }
  else { hi = Math.max(v, r.max) * 1.4; z0 = r.min; z1 = r.max; }
  const at = (x) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo || 1)) * 100));
  return { pos: at(v), z0: at(z0), z1: at(z1) };
}
const KPI_COL = { ok: "var(--sc-g)", warn: "var(--sc-a)", miss: "var(--sc-r)" };
const KPI_INK = { ok: "teal-ink", warn: "amber-ink", miss: "red-ink" };
/* ▲▼ against last month: green when it moved the right way */
function kpiDelta(it) {
  if (!it.prev || typeof it.prev.value !== "number" || typeof it.value !== "number" || !it.rule || !["ok", "warn", "miss"].includes(it.status)) return null;
  const a = it.value, b = it.prev.value; if (!isFinite(a) || !isFinite(b)) return null;
  if (Math.abs(a - b) < 1e-9) return { txt: "=", good: null };
  const pct = it.rule.fmt === "percent", diff = pct ? Math.round(Math.abs(a - b) * 1000) / 10 : Math.round(Math.abs(a - b) * 10) / 10;
  const better = it.rule.dir === "higher" ? a > b : it.rule.dir === "lower" ? a < b : null;
  return { txt: (a > b ? "▲" : "▼") + diff, good: better };
}
/* How far a missed KPI is from its standard, for "Fix first" */
function kpiGap(it) {
  const r = it.rule, v = Number(it.value); if (!r || !isFinite(v)) return null;
  const pct = r.fmt === "percent", g = r.dir === "lower" ? v - r.good : r.dir === "higher" ? r.good - v : 0;
  if (!(g > 0)) return null;
  const rel = g / (Math.abs(r.good) || 1);
  return { rel, txt: pct ? Math.round(g * 1000) / 10 + (Math.round(g * 1000) / 10 === 1 ? " pt " : " pts ") + (r.dir === "lower" ? "over" : "under") : Math.round(g * 10) / 10 + (r.fmt === "days" ? " days" : "") + " " + (r.dir === "lower" ? "over" : "under") };
}
/* How far inside its target an on-target KPI is ("6.3 pts better"), for Doing well */
function kpiInside(it) {
  const r = it.rule, v = Number(it.value); if (!r || !isFinite(v) || !["higher", "lower"].includes(r.dir)) return null;
  const pct = r.fmt === "percent", g = r.dir === "lower" ? r.good - v : v - r.good;
  if (!(g >= 0)) return null;
  return { rel: g / (Math.abs(r.good) || 1), txt: (pct ? Math.round(g * 1000) / 10 + " pts" : Math.round(g * 10) / 10 + (r.fmt === "days" ? " days" : "")) + " better" };
}
const Ring = ({ pct, band, size = 30, w = 4 }) => (
  <span className="sc-ring" style={{ width: size, height: size, background: `conic-gradient(${band ? KPI_COL[band] : "#C9D1D9"} 0 ${Math.max(2, pct || 0)}%, var(--soft) ${Math.max(2, pct || 0)}% 100%)` }}><i style={{ inset: w }} /></span>
);
function SlaScorecard({ ctx, me, go, clientId, setClientId, openInputs }) {
  const [kind, setKind] = useState("month");
  const [pid, setPid] = useState("");   // the period picked with ‹ ›, by its id (two periods can end on the same day)
  const [open, setOpen] = useState(null);
  const [showNs, setShowNs] = useState({});
  const [fellBack, setFellBack] = useState("");
  useEffect(() => { setPid(""); setShowNs({}); }, [clientId, kind]);
  useEffect(() => { setFellBack(""); }, [clientId]);
  const only = onlyClient(ctx);
  useEffect(() => { if (!clientId && only) setClientId(only); }, [only]);
  const q = useRpc("sla.scorecard", { client_id: clientId, kind, period_id: pid || undefined, today: todayISO() }, [clientId, kind, pid], !!clientId);
  const d = q.data && q.data.client && q.data.client.id === clientId ? q.data : null;
  // Monthly or Weekly asked, but the client has none of that kind: switch to what it has and say so
  useEffect(() => { if (d && d.fallback && d.period && d.period.kind !== kind) { setFellBack(d.fallback); setKind(d.period.kind === "month" || d.period.kind === "week" ? d.period.kind : "latest"); } }, [d && d.fallback, d && d.period && d.period.id]);
  const cur = d && d.period ? d.period : null;
  const xq = useRpc("sla.extras", { client_id: clientId, from: cur ? cur.from : undefined, to: cur ? cur.to : undefined, today: todayISO() }, [clientId, cur && cur.from, cur && cur.to], !!clientId);
  const x = xq.data;
  const client = ctx.clients.find((c) => c.id === clientId);
  const periods = d && d.periods ? d.periods.filter((p) => kind === "latest" || p.kind === kind) : [];
  const idx = cur ? periods.findIndex((p) => p.id === cur.id) : -1;
  const step = (n) => { const p = periods[idx + n]; if (p) setPid(p.id); };
  const first = client ? client.name : "";
  const csv = () => downloadText(toCSV(d.items, SLA_COLS), `sla-scorecard-${first}-${cur ? cur.label : ""}.csv`.replace(/[\/:*?"<>|]+/g, " "));
  const monthOf = (p) => (p && p.kind === "month" && p.from ? p.from.slice(0, 7) : "");
  const f1 = (v) => (v == null ? "–" : String(Math.round(v * 10) / 10));
  const ok = d && d.state === "ok";
  // Fix first: the 3 furthest from standard (missed first, then close). With nothing missed or close: Doing well, the 3
  // KPIs furthest inside their target, which carry the score.
  const gapped = ok ? d.items.filter((i) => i.status === "miss" || i.status === "warn").map((i) => ({ i, g: kpiGap(i) })).filter((z) => z.g)
    .sort((a, b) => (a.i.status === "miss" ? 0 : 1) - (b.i.status === "miss" ? 0 : 1) || b.g.rel - a.g.rel).slice(0, 3) : [];
  const good = ok && (d.band === "ok" || !gapped.length) ? d.items.filter((i) => i.status === "ok").map((i) => ({ i, g: kpiInside(i) })).sort((a, b) => (b.g ? b.g.rel : -1) - (a.g ? a.g.rel : -1)).slice(0, 3) : [];
  const fixGood = ok && (d.band === "ok" || !gapped.length), fix = fixGood ? good : gapped;
  const notScored = ok ? d.scopes.reduce((t, sc) => t + (sc.missing || []).length, 0) : 0;
  const tr = ok ? d.trend : [];
  const sx = (k) => (tr.length > 1 ? 14 + (k * 272) / (tr.length - 1) : 150), sy = (p) => 18 + (1 - (p == null ? 0 : p) / 100) * 46;
  const bandWord = { ok: "GREEN", warn: "AMBER", miss: "RED" };
  return (
    <div className="stack sc2" style={{ gap: 12 }}>
      <div className="card sc-bar">
        <div style={{ minWidth: 250 }}><ClientPicker ctx={ctx} clientId={clientId} setClientId={setClientId} /></div>
        <div className="seg2">{PSLA_KIND.map(([k, l]) => <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => { setFellBack(""); setKind(k); }}>{l}</button>)}</div>
        {cur && <span className="crx-per"><button type="button" disabled={idx < 0 || idx >= periods.length - 1} onClick={() => step(1)} title="The period before">‹</button><b>{cur.label}</b><button type="button" disabled={idx <= 0} onClick={() => step(-1)} title="The period after">›</button></span>}
        <span style={{ flex: 1 }} />
        {x && <><span className="sc-chip" title={x.wfm && (x.wfm.shared || []).length ? "Shared evenly with other clients: " + x.wfm.shared.map((p) => p.name + " (" + p.clients + " clients)").join(", ") : undefined}>Billable FTE <b>{x.wfm ? f1(x.wfm.billable) : "–"}</b>{x.wfm && (x.wfm.shared || []).length ? " *" : ""}</span><span className="sc-chip">Assign FTE <b>{x.wfm ? f1(x.wfm.assigned_fte) : "–"}</b></span>
          <span className="sc-chip">Escalations <b className={x.esc && x.esc.n ? "red-ink" : ""}>{x.esc ? x.esc.n : "–"}</b></span></>}
        {ok && <button className="btn sm" onClick={csv} disabled={!d.items.length}>⬇ CSV</button>}
        <button className="btn sm primary" onClick={openInputs} title="Drishti's page: upload the period's reports or type a value">Reports →</button>
      </div>
      {!clientId ? <div className="card"><Empty>Pick a client to see its scorecard.</Empty></div> : q.error ? <ErrorBox error={q.error} /> : !d ? <div className="card"><Spinner label="Reading Drishti's scorecard…" /></div>
        : d.state === "off" ? <div className="alert warn">Drishti's scorecard is not connected yet: the Worker secret DRISHTI_TOKEN_SECRET is not set (README › Drishti opens signed in). Until then, use <b>Inputs (Drishti)</b>.</div>
        : d.state === "error" ? <div className="alert err">Drishti did not answer: {d.error} Brahmastra tries again in a few minutes.</div>
        : d.state === "unmatched" ? <div className="alert warn"><b>{first}</b> is not in Drishti under this name. Drishti knows: {(d.others || []).join(", ") || "no clients yet"}. Name the client the same in both, or add it in <b>Inputs (Drishti)</b>.</div>
        : d.state === "no_period" ? <div className="alert info">Drishti has no scored period for <b>{first}</b> yet. Upload the period's reports in <b>Inputs (Drishti)</b> and it shows here.</div>
        : <>
          {fellBack && <div className="alert info">Drishti has no {fellBack === "month" ? "monthly" : fellBack === "week" ? "weekly" : fellBack} scorecard for <b>{first}</b>, so its {d.period.kind === "week" ? "weeks are" : d.period.kind === "month" ? "months are" : "periods are"} shown.</div>}
          {(d.ambiguous || []).length > 1 && <div className="alert warn">Drishti has {d.ambiguous.length} clients whose names match <b>{first}</b>: {d.ambiguous.join(", ")}. This is <b>{d.drishti.name}</b>. Rename the others in Drishti so the scores cannot mix.</div>}
          <div className={"card sc-hero glow " + (d.band || "none")}>
            <div className="sc-big" style={{ background: `conic-gradient(${d.band ? KPI_COL[d.band] : "#C9D1D9"} 0 ${Math.max(2, d.score || 0)}%, var(--soft) ${Math.max(2, d.score || 0)}% 100%)` }}>
              <div><b className={d.band ? KPI_INK[d.band] : ""}>{d.score == null ? "–" : d.score + "%"}</b><small className={d.band ? KPI_INK[d.band] : ""}>{d.band ? bandWord[d.band] : "NO SCORE"}</small></div></div>
            <div style={{ minWidth: 0 }}>
              <div className="sc-name">{first} <button type="button" className="btn link tiny" style={{ padding: 0, fontWeight: 700 }} onClick={() => go("client", { client_id: clientId })}>Client 360 ›</button></div>
              <div className="small muted" style={{ marginTop: 3 }}>{cur.label}{d.delta != null && d.prev ? <> · {d.delta ? <b className={d.delta > 0 ? "teal-ink" : "red-ink"}>{d.delta > 0 ? "▲" : "▼"} {Math.abs(d.delta)} pts</b> : <span>no change</span>} vs {d.prev.label}</> : null}
                {monthOf(cur) && d.score != null ? " · month closed" : ""} · scored in Drishti</div>
              <div className="sc-stats"><span className="ok"><b>{d.counts.ok}</b>on target</span><span className="warn"><b>{d.counts.warn}</b>close</span><span className="miss"><b>{d.counts.miss}</b>missed</span><span className="none"><b>{notScored}</b>not scored</span></div>
            </div>
            <div className="sc-trend"><div className="sc-lbl">Score · {tr.length} {cur.kind === "week" ? "weeks" : cur.kind === "month" ? "months" : "periods"}</div>
              {tr.length > 1 ? <svg width="300" height="80" viewBox="0 0 300 80"><rect x="0" y="6" width="300" height={sy(90) - 6} fill="var(--sc-zone)" rx="3" /><text x="296" y="15" textAnchor="end" fontSize="9" className="teal-ink" fill="currentColor">green 90%+</text>
                <polyline fill="none" stroke="var(--slate)" strokeWidth="2" strokeLinejoin="round" points={tr.map((p, k) => sx(k) + "," + sy(p.pct)).join(" ")} />
                {tr.map((p, k) => <g key={p.id}><circle cx={sx(k)} cy={sy(p.pct)} r={k === tr.length - 1 ? 4.5 : 2.5} fill={k === tr.length - 1 ? (d.band ? KPI_COL[d.band] : "var(--slate)") : "var(--slate)"} /><title>{p.label}: {p.pct == null ? "–" : p.pct + "%"}</title>
                  <text x={sx(k)} y="78" textAnchor="middle" fontSize="10" fill="currentColor" className={k === tr.length - 1 ? "" : "muted"} fontWeight={k === tr.length - 1 ? 700 : 400}>{String(p.label).slice(0, 3)}</text></g>)}</svg>
                : <div className="small muted" style={{ marginTop: 8 }}>The trend shows from the second period on.</div>}</div>
          </div>
          {fix.length > 0 && <div className={"card sc-fix glow" + (fixGood ? " good" : "")}>
            <div>{fixGood ? <><div className="sc-lbl teal-ink">Doing well</div><div className="tiny muted">top 3 carrying the score</div></> : <><div className="sc-lbl red-ink">Fix first</div><div className="tiny muted">furthest from standard</div></>}</div>
            {fix.map(({ i, g }, fx) => { const dl = kpiDelta(i); return <button type="button" key={i.scope_key + i.key + ":" + fx} className="sc-fx" onClick={() => setOpen(i)}><b className={KPI_INK[i.status]}>{i.shown}</b><span><span className="b">{i.name}</span><span className="tiny muted">{i.scope} · {i.target || "standard"}{g ? " · " + g.txt : ""}{dl ? <> · <span className={dl.good === true ? "teal-ink" : dl.good === false ? "red-ink" : ""}>{dl.txt}</span></> : null}</span></span></button>; })}
          </div>}
          <div className="sc-grid">{d.scopes.map((sc) => {
            const items = d.items.filter((i) => i.scope_key === sc.key);
            // The card takes the colour of its weakest KPI: with only 2 or 3 KPIs, one "close" would make the % red with nothing missed.
            const nMiss = items.filter((i) => i.status === "miss").length, nWarn = items.filter((i) => i.status === "warn").length;
            const cb = !sc.scored ? sc.band : nMiss ? "miss" : nWarn ? "warn" : "ok";
            return (
              <div key={sc.key} className={"card sc-card glow " + (cb || "")}>
                <div className="sc-h"><span className="row" style={{ gap: 8 }}><Ring pct={sc.pct} band={cb} /><b>{sc.name}</b></span><span className={"badge " + (cb === "ok" ? "green" : cb === "warn" ? "amber" : cb ? "red" : "gray")}>{sc.ok} of {sc.scored} on target{nMiss ? " · " + nMiss + " missed" : nWarn ? " · " + nWarn + " close" : ""}</span></div>
                {items.map((i, ix) => { const bar = kpiBar(i), dl = kpiDelta(i); return (
                  <button type="button" key={i.key + ":" + ix} className="sc-kp" onClick={() => setOpen(i)}>
                    <span className="sc-dot" style={{ background: KPI_COL[i.status] || "#C9D1D9" }} /><span className="sc-kn">{i.name}</span><span className={"sc-kv " + (KPI_INK[i.status] || "")}>{i.shown || "–"}</span>
                    <span className="sc-kb"><span className="sc-std">{i.target || "–"}</span>
                      {bar ? <span className="sc-track"><i className="z" style={{ left: bar.z0 + "%", width: Math.max(0, bar.z1 - bar.z0) + "%" }} /><i className="m" style={{ left: bar.pos + "%", background: KPI_COL[i.status] }} /></span>
                        : <span className="sc-note">{i.kind === "SLA" ? i.source : (i.reason || i.source)}</span>}
                      <span className={"sc-dl " + (dl && dl.good === true ? "teal-ink" : dl && dl.good === false ? "red-ink" : "muted")}>{dl ? dl.txt : ""}</span></span>
                  </button>); })}
                {(sc.missing || []).length > 0 && !showNs[sc.key] && <button type="button" className="sc-kp ns sc-more" onClick={() => setShowNs({ ...showNs, [sc.key]: true })}><span className="sc-dot" style={{ background: "#C9D1D9" }} /><span className="sc-kn">{sc.missing.length} not scored yet</span><span className="sc-kv tiny teal-ink">show ▾</span></button>}
                {showNs[sc.key] && (sc.missing || []).map((m) => <div key={m.key} className="sc-kp ns"><span className="sc-dot" style={{ background: "#C9D1D9" }} /><span className="sc-kn">{m.name}</span><span className="sc-kv muted">–</span>
                  <span className="sc-kb"><span className="sc-note">Not scored · {m.typed ? "type it in Drishti" : m.from + " missing"} · <button type="button" className="btn link tiny" style={{ padding: 0 }} onClick={openInputs}>add it</button></span></span></div>)}
                {!items.length && !(sc.missing || []).length && <div className="small muted" style={{ padding: "12px 16px" }}>Nothing scored for this scope yet.</div>}
              </div>);
          })}</div>
          <div className="sc-legend"><span><i className="z" />target zone</span><span><i style={{ background: "var(--sc-g)" }} />on target</span><span><i style={{ background: "var(--sc-a)" }} />close</span><span><i style={{ background: "var(--sc-r)" }} />missed</span><span>▲▼ change from {d.prev ? d.prev.label : "the period before"}</span><span>card colour: its weakest KPI</span><span style={{ marginLeft: "auto" }}>Click any KPI for its formula, source report and comment</span></div>
        </>}
      {clientId && <SlaExtras clientId={clientId} from={ok && cur ? cur.from : ""} to={ok && cur ? cur.to : ""} label={ok && cur ? cur.label : ""} go={go} escOnly />}
      {open && <Modal title={open.name} sub={open.scope + " · " + (cur ? cur.label : "")} onClose={() => setOpen(null)} narrow>
        <div className="stack" style={{ gap: 10 }}>
          <div><b className={KPI_INK[open.status] || ""} style={{ fontSize: 24 }}>{open.shown || "–"}</b> <span className="muted">· standard {open.target || "–"} · {{ ok: "on target", warn: "close", miss: "missed" }[open.status] || "info"}{(() => { const dl = kpiDelta(open); return dl ? <> · <span className={dl.good === true ? "teal-ink" : dl.good === false ? "red-ink" : ""}>{dl.txt}</span> vs {d.prev ? d.prev.label : "before"}</> : null; })()}</span></div>
          {(open.history || []).length > 1 && (() => { const hs = open.history, vals = hs.map((h) => Number(h.value)).filter((v) => isFinite(v)), mx = Math.max(...vals, 0) || 1; return (
            <div><div className="sc-lbl">Last {hs.length} {cur && cur.kind === "week" ? "weeks" : "months"}</div><div className="sc-hist">{hs.map((h, k) => <div key={k} title={h.label + ": " + (h.shown || "–")}><span className="tiny">{h.shown || "–"}</span><i style={{ height: isFinite(Number(h.value)) ? 6 + (Number(h.value) / mx) * 46 : 3, background: h.status ? KPI_COL[h.status] : "#C9D1D9", opacity: k === hs.length - 1 ? 1 : 0.55 }} /><span className={"tiny " + (k === hs.length - 1 ? "b" : "muted")}>{String(h.label).slice(0, 3)}</span></div>)}</div></div>); })()}
          <div><div className="sc-lbl">Formula</div><div className="cell small">{open.formula || "–"}</div></div>
          <div><div className="sc-lbl">From</div><div className="cell small">{open.source}</div></div>
          {open.reason && <div><div className="sc-lbl">Comment</div><div className="cell small">{open.reason}</div></div>}
          {open.std && <div className="tiny muted">Drishti's standard: {open.std}</div>}
        </div>
      </Modal>}
    </div>
  );
}
/* Beside the scorecard: the client's people in Shastra WFM (Billable vs Assigned) and its escalations in the period, SLA threshold 0. */
function SlaExtras({ clientId, from, to, label, go, escOnly }) {
  const q = useRpc("sla.extras", { client_id: clientId, from: from || undefined, to: to || undefined, today: todayISO() }, [clientId, from, to]);
  const x = q.data; if (!x) return q.error ? <ErrorBox error={q.error} /> : null;
  const w = x.wfm, e = x.esc, f1 = (v) => (v == null ? "–" : String(Math.round(v * 10) / 10));
  const util = w && w.billable ? Math.round((w.assigned_fte / w.billable) * 100) : null;
  return (
    <>
      {!escOnly && <div className="card"><div className="row between" style={{ alignItems: "flex-start" }}><div className="cv-sec" style={{ margin: 0 }}>Resources · Shastra WFM</div>
        <span className="tiny muted">{w ? (w.projects.length > 1 ? "projects " : "project ") + w.projects.join(", ") + (w.today ? " · as of " + fmtMDY(w.today) : "") : ""}</span></div>
        {w ? <div className="grid g2" style={{ marginTop: 8, maxWidth: 560 }}>
          <Kpi label="Billable FTE" value={f1(w.billable)} />
          <Kpi label="Assign FTE" value={f1(w.assigned_fte)} tone={util != null && util < 100 ? "warn" : ""} />
        </div> : <div className="small muted" style={{ marginTop: 6 }}>{x.wfm_ok ? "No Shastra project is matched to this client yet: match its roster project in Clients & locations." : "Billable and Assigned come from Shastra's Workforce Management once dev/shastra-wfm-feed.sql is run in Shastra (README › Purview Shastra)."}</div>}
      </div>}
      <div className="card"><div className="row between" style={{ alignItems: "flex-start" }}>
        <div><div className="cv-sec" style={{ margin: 0 }}>Escalations · {label || x.month}</div><div className="tiny muted">From the Escalation tracker, by received date. SLA threshold 0: none is green, one or more is red, for each department.</div></div>
        <button className="btn sm" onClick={() => go("escalations", { client_id: clientId })}>Open the Escalation tracker</button></div>
        <div className="grid g5" style={{ marginTop: 10 }}>
          <Kpi label={"Logged · target " + e.target} value={fmtInt(e.n)} tone={e.n ? "bad" : "good"} sub={e.n ? "Red" : "Green"} />
          <Kpi label="Open" value={fmtInt(e.open)} tone={e.open ? "bad" : ""} />
          <Kpi label="Open over 24 h" value={fmtInt(e.over24)} tone={e.over24 ? "warn" : ""} sub={e.over24 ? e.over24_reason + " with a reason" : ""} />
          <Kpi label="Our error (Y)" value={fmtInt(e.errors)} />
          <Kpi label="Average time to close" value={e.avg_hours == null ? "–" : e.avg_hours + " h"} />
        </div>
        {e.by_dept.length > 0 && <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 10 }}>{e.by_dept.map((b) => <span key={b.dept} className="badge red">{b.dept} {b.n}</span>)}</div>}
        {e.rows.length > 0 && <div className="table-wrap" style={{ marginTop: 10 }}><table className="t"><thead><tr><th>SR No</th><th>Department</th><th>Received</th><th>Error description</th><th>Error</th><th>Responding</th><th>Status</th></tr></thead>
          <tbody>{e.rows.map((r) => <tr key={r.id}><td className="mono small"><b>SR{r.sr}</b></td><td className="small">{r.dept}</td><td className="small">{fmtMDY(r.day)}</td><td className="small" style={{ maxWidth: 420 }}>{r.description}</td>
            <td className="small">{r.is_error || "–"}</td><td className="small">{r.owner_name || "–"}</td>
            <td>{r.status === "resolved" ? <span className="badge green">Closed {fmtMDY(r.close_on)}</span> : <span className={"badge " + (r.open_hours > 24 ? (r.delay_reason ? "amber" : "red") : "gray")}>Open · {r.open_hours} h{r.expected_on ? " · expected " + fmtMDY(r.expected_on) : r.open_hours > 24 ? " · reason needed" : ""}</span>}</td></tr>)}</tbody></table></div>}
      </div>
    </>
  );
}
function MyDeskView(props) { return <QueueView {...props} />; }
function ReportsView({ ctx, from, to, embedded }) {
  const [f, setF] = useState({ client_id: "", location_id: "", user_id: "", kind: "work", from: from || addDaysISO(todayISO(), -6), to: to || todayISO() });
  const payload = { client_id: f.client_id || undefined, location_id: f.location_id || undefined, user_id: f.user_id || undefined, kind: f.kind || undefined, from_ms: dayBounds(f.from)[0], to_ms: dayBounds(f.to)[1] };
  const q = useRpc("reports.work", payload, [JSON.stringify(payload)]);
  const rows = q.data ? q.data.rows : [];
  const rSort = useTableSort("created_at", "desc");
  const shownRows = rSort.sortRows(rows);
  const claims = new Set(rows.map((r) => r.claim_id)).size;
  const byStatus = useMemo(() => { const m = {}; rows.filter((r) => r.kind === "work").forEach((r) => { m[r.status_code] = m[r.status_code] || { key: r.status_code, n: 0, amt: 0 }; m[r.status_code].n++; m[r.status_code].amt += r.balance; }); return Object.values(m).sort((a, b) => b.n - a.n); }, [rows]);
  return (
    <div className="stack">
      <div className="row between"><div>{!embedded && <h1>Reports</h1>}<div className="sub">Every note the team wrote, with the claim it belongs to. Download as CSV for the client or for QA.</div></div>
        <div className="row" style={{ gap: 8 }}><button className="btn" disabled={!rows.length} title="One row per entry, in the Production Conso columns" onClick={async () => { try { const r = await rpc("reports.production", { scope: "ar", client_id: f.client_id || undefined, location_id: f.location_id || undefined, user_id: f.user_id || undefined, from_ms: dayBounds(f.from)[0], to_ms: dayBounds(f.to)[1] }); downloadText(arrayCSV(r.header, r.rows), `Production - entries - ${f.from} to ${f.to}.csv`); } catch (e) { toast(e.message, "err"); } }}>Download CSV</button>
          <button className="btn link sm" disabled={!rows.length} title="Brahmastra's own columns, the note fields apart" onClick={() => downloadText(toCSV(rows.map(reportRow), REPORT_COLS), `brahmastra-work-${f.from}-to-${f.to}.csv`)}>Brahmastra columns</button></div></div>
      <div className="card tight grid g5">
        <ClientPicker ctx={ctx} clientId={f.client_id} setClientId={(v) => setF({ ...f, client_id: v, location_id: "" })} locId={f.location_id} setLocId={(v) => setF({ ...f, location_id: v })} allowAll />
        <Field label="Team member"><Combo value={f.user_id} onChange={(v) => setF({ ...f, user_id: v })} placeholder="Everyone" options={[{ id: "", label: "Everyone" }, ...ctx.users.map((u) => ({ id: u.id, label: u.name, sub: u.designation || undefined }))]} /></Field>
        {!embedded && <DateRange value={f.range || newRange("week")} onChange={(r) => { const [a, b] = rangeSpan(r); setF({ ...f, range: r, from: a, to: b }); }} />}
      </div>
      <div className="row" style={{ gap: 4 }}>{[["work", "Worked claims"], ["skip", "Skips"], ["note", "Notes"], ["", "Everything"]].map(([k, l]) => <button key={k} className={"chip " + (f.kind === k ? "on" : "")} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div>
      <ErrorBox error={q.error} />
      {q.data && (
        <div className="grid g4">
          <Kpi label="Entries" value={fmtInt(rows.length)} sub={`${fmtInt(claims)} distinct claims`} tone="accent" />
          <Kpi label="Balance touched" value={fmtMoney(sum(rows.filter((r) => r.kind === "work"), (r) => r.balance))} sub="sum over worked entries" />
          <Kpi label="Resolved now" value={fmtInt(rows.filter((r) => r.state === "closed").length)} sub="claims closed by a resolving status" tone="good" />
          <Kpi label="Top SAAG status" value={byStatus[0] ? byStatus[0].key : "–"} sub={byStatus[0] ? fmtInt(byStatus[0].n) + " entries · " + fmtMoney(byStatus[0].amt) : ""} />
        </div>
      )}
      <div className="card tight">
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap" style={{ maxHeight: 600 }}><table className="t"><thead><tr>{rSort.Th("created_at", "When")}{rSort.Th("user_name", "Who")}{rSort.Th("client_name", "Client")}{rSort.Th("claim_no", "Claim #")}{rSort.Th("patient", "Patient")}{rSort.Th("payer", "Payer")}{rSort.Th("balance", "Balance", "r")}{rSort.Th("status_code", "Status")}{rSort.Th("action_code", "Action")}{rSort.Th("follow_up_on", "Follow-up")}<th>Comment</th></tr></thead>
          <tbody>{shownRows.map((r, i) => <tr key={i}><td className="small">{fmtWhen(r.created_at)}</td><td className="small">{r.user_name}</td><td className="small">{r.client_name}{r.location_name ? " · " + r.location_name : ""}</td><td className="mono small">{r.claim_no || "–"}</td><td>{r.patient}</td><td className="small">{r.payer}</td><td className="num">{fmtMoney(r.balance)}</td><td className="small">{r.status_code ? <><b>{r.status_code}</b>{r.sub_status ? <div className="tiny muted">{r.sub_status}</div> : null}</> : <span className="tiny muted">{r.kind}</span>}</td><td className="small">{r.action_code || ""}{r.work_bucket ? <div><span className={"badge " + (r.work_bucket === "Closed" ? "green" : "teal")}>{r.work_bucket}</span></div> : null}</td><td className="small">{r.follow_up_on ? fmtDate(r.follow_up_on) : ""}</td><td className="small" style={{ maxWidth: 360 }}>{r.comment}</td></tr>)}
            {q.data && !rows.length && <tr><td colSpan={11}><Empty>No entries in this range.</Empty></td></tr>}</tbody></table></div>
      </div>
    </div>
  );
}


/* ====================================================================
   PART 4 — the team member's queue, work form, history, and the app
   ==================================================================== */
/* My day: claims this biller worked that were resubmitted (by Submission or Rejections) and wait on the recheck: accepted by
   the payer, or rejected again? The biller can mark it, with the TAT left; rejected again goes back to the department. */
function MyRechecks({ ctx, me }) {
  const q = useRpc("handoffs.myRechecks", {}, []);
  const [act, setAct] = useState(null);
  const [open, setOpen] = useState(null);
  const rows = q.data ? q.data.rows : [];
  if (!rows.length) return null;
  const left = (ms) => { const h = Math.round(Math.abs(ms) / 3600000); return h >= 24 ? Math.round(h / 24) + "d" : h + "h"; };
  return (
    <div className="card tight">
      <div className="row between" style={{ padding: "12px 14px 0" }}>
        <div><h3 style={{ margin: 0 }}>Resubmitted · recheck <span className="badge teal" style={{ marginLeft: 6 }}>{rows.length}</span></h3>
          <div className="sub">Claims you worked that were resubmitted. Check the payer: mark <b>Accepted</b>, or <b>Rejected again</b> (it goes straight back to the department to fix and resubmit).</div></div>
        {rows.some((r) => r.overdue) && <span className="badge red">{rows.filter((r) => r.overdue).length} past the TAT</span>}
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}><table className="t"><thead><tr><th>TAT</th><th>Claim #</th><th>Patient</th><th>Client</th><th>Payer</th><th className="r">Balance</th><th>Resubmitted</th><th></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className={r.overdue ? "tat-missed" : ""}>
            <td style={{ whiteSpace: "nowrap" }}>{!r.open ? <span className="badge gray" title="The payer usually shows the result after 48 working hours">opens {fmtWhen(r.available_at)}</span>
              : r.overdue ? <span className="badge red">{left(r.left_ms)} past TAT</span> : <span className={"badge " + (r.due_soon ? "amber" : "teal")}>{left(r.left_ms)} left</span>}<div className="tiny muted">due {fmtWhen(r.due_at)}</div></td>
            <td className="mono small">{r.claim_no || "–"}</td><td>{r.patient}<div className="tiny muted">{r.account_no}</div></td><td className="small">{r.client_name}</td><td className="small">{r.payer}</td><td className="num">{fmtMoney(r.balance)}</td>
            <td className="small"><span className={"badge " + (r.from_dept === "rejection" ? "red" : "blue")}>{r.from_label}</span><div className="tiny muted">{r.created_by_name} · {fmtWhen(r.created_at)}</div>{r.check_name && r.assigned_to !== me.id ? <div className="tiny muted">recheck with {r.check_name} too</div> : null}</td>
            <td className="r" style={{ whiteSpace: "nowrap" }}><button className="btn sm" onClick={() => setOpen(r.claim_id)}>Open claim</button> <button className="btn sm primary" onClick={() => setAct({ h: r, outcome: "complete" })}>✓ Accepted</button> <button className="btn sm danger" onClick={() => setAct({ h: r, outcome: "rejected" })}>✗ Rejected again</button></td>
          </tr>))}</tbody></table></div>
      {act && <HandoffCloseModal act={act} onClose={() => setAct(null)} onDone={() => { setAct(null); q.reload(); }} />}
      {open && <ClaimDrawer id={open} ctx={ctx} me={me} onClose={() => { setOpen(null); q.reload(); }} onChanged={() => q.reload()} />}
    </div>
  );
}
function QueueView({ ctx, me }) {
  const today = todayISO();
  const [from, to] = dayBounds(today);
  const summary = useRpc("queue.summary", { day_from_ms: from, day_to_ms: to }, []);
  const EMPTY_F = { q: "", payer: "", provider: "", cpt: "", min_balance: "", max_balance: "", saag_status: "", saag_bucket: "", state: "", client_id: "", location_id: "", due: "" };
  const [f, setF] = useState(EMPTY_F);
  const payload = useMemo(() => { const o = { day_from_ms: from }; for (const k in f) if (f[k] !== "" && k !== "due") o[k] = f[k]; return o; }, [f]);
  const list = useRpc("queue.list", payload, [JSON.stringify(payload)]);
  const [bundle, setBundle] = useState(null);
  const [busy, setBusy] = useState(false);
  const [emptyMsg, setEmptyMsg] = useState(null);
  const [patientOf, setPatientOf] = useState(null);
  const refreshAll = () => { summary.reload(); list.reload(); };
  /* "Next" with a claim already open puts that claim back on the list (nothing is saved) and opens the one after it. */
  const next = async () => {
    setBusy(true); setEmptyMsg(null);
    try { const r = await rpc("queue.next", bundle ? { skip_id: bundle.claim.id } : {}); if (!r.claim) { setBundle(null); setEmptyMsg("Nothing left to work. Claims whose follow-up date has not arrived stay parked until then; ask your team lead for a new allocation."); } else { setBundle(r); window.scrollTo(0, 0); } refreshAll(); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const open = async (id) => {
    setBusy(true); setEmptyMsg(null);
    try { const r = await rpc("queue.open", { id }); setBundle(r); refreshAll(); window.scrollTo(0, 0); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  const refreshBundle = async () => { if (!bundle) return; try { const r = await rpc("claims.get", { id: bundle.claim.id }); setBundle({ ...r, claim: { ...bundle.claim, ...r.claim } }); } catch (e) { toast(e.message, "err"); } };
  // The day opens on the dashboard; a claim left open shows as "Continue my open claim" instead of opening by itself.
  const s = summary.data;
  /* "Due" = when this claim should be done: parked claims on their follow-up date; the rest in list order,
     a day's worth (the biller's claims per day) at a time: Today, Tomorrow, in 2 days... */
  const cap = Math.max(1, Number(me.capacity) || 35);
  const allRows = list.data ? list.data.rows : [];
  const dueOf = useMemo(() => {
    const m = {}; let n = 0;
    allRows.forEach((r) => {
      if (r.state === "completed" || r.state === "closed") { m[r.id] = { days: -1, label: "Done" }; return; }
      const ahead = r.follow_up_on && r.follow_up_on > today ? daysBetween(today, r.follow_up_on) : 0;
      const slot = Math.floor(n / cap); n++;
      const days = Math.max(ahead, slot);
      m[r.id] = { days, label: days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days` };
    });
    return m;
  }, [allRows, cap, today]);
  const rows = useMemo(() => allRows.filter((r) => { if (!f.due) return true; const d = dueOf[r.id] ? dueOf[r.id].days : 0; return f.due === "today" ? d === 0 : f.due === "tomorrow" ? d === 1 : d >= 2; }), [allRows, f.due, dueOf]);
  const qSort = useTableSort();
  const shownRows = qSort.sortRows(rows, { due: (r) => (dueOf[r.id] ? dueOf[r.id].days : 99), saag: (r) => r.last_status_code || "", bucket: (r) => r.last_bucket || "" });
  const counts = useMemo(() => { const c = { green: 0, yellow: 0, white: 0 }; rows.forEach((r) => { const t = workTone(r); c[t === "tr-green" ? "green" : t === "tr-yellow" ? "yellow" : "white"]++; }); return c; }, [rows]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const myClients = useMemo(() => ctx.clients.filter((c) => allRows.some((r) => r.client_id === c.id)), [ctx.clients, allRows]);
  const myLocs = useMemo(() => { const c = myClients.find((x) => x.id === f.client_id); return c ? c.locations.filter((l) => allRows.some((r) => r.location_id === l.id)) : []; }, [myClients, f.client_id, allRows]);
  const saagOptions = useMemo(() => [...new Set(rows.map((r) => r.last_status_code).filter(Boolean))].sort(), [rows]);
  return (
    <div className="stack">
      <div className="row between top">
        <div><h1>Hi {firstNameOf(me)}, here is your day</h1><div className="sub">Your allocations in priority order. Work the next one, or open any claim from the list. Each entry needs the SAAG status, a bucket and the note.</div></div>
        <button className="btn primary lg" onClick={next} disabled={busy || (s && !s.ready.n && !s.in_progress_id)} title={bundle ? "Put this claim back on the list without saving and open the next one" : ""}>{busy ? "Loading…" : s && s.in_progress_id && !bundle ? "Continue my open claim" : bundle ? "Next claim →" : "Work the next claim"}</button>
      </div>
      <ErrorBox error={summary.error} />
      {s && (
        <div className="grid g4">
          <Kpi label="Ready to work" value={fmtInt(s.ready.n)} sub={fmtMoney(s.ready.amt) + (s.waiting ? ` · ${fmtInt(s.waiting)} parked until follow-up` : "")} tone="accent" />
          <Kpi label="Worked today" value={fmtInt(s.done_today.n)} sub={fmtMoney(s.done_today.amt) + " touched"} tone="good" />
          <Kpi label="Skipped (back of the line)" value={fmtInt(s.skipped)} sub="come up again after the rest" tone={s.skipped ? "warn" : ""} />
          <div className="kpi"><div className="l">By client</div>{(s.by_client || []).slice(0, 3).map((c, i) => <div key={i} className="small"><b>{c.client_name}</b>{c.location_name ? <span className="muted"> · {c.location_name}</span> : null} <span className="mono muted">{fmtInt(c.n)}</span></div>)}{!(s.by_client || []).length && <div className="small muted">Nothing assigned.</div>}</div>
        </div>
      )}
      {emptyMsg && <div className="card"><Empty>{emptyMsg}</Empty></div>}
      <MyRechecks ctx={ctx} me={me} />
      {patientOf && <PatientModal id={patientOf} ctx={ctx} me={me} onClose={() => setPatientOf(null)} onOpenClaim={(r) => { if (r.mine && ["assigned", "in_progress", "completed"].includes(r.state)) { setPatientOf(null); open(r.id); } }} />}
      {bundle && <WorkPanel key={bundle.claim.id} bundle={bundle} ctx={ctx} me={me} onPatient={() => setPatientOf(bundle.claim.id)} onDone={(mode) => { if (mode === null) return refreshBundle(); setBundle(null); refreshAll(); if (mode) next(); }} />}
      <div className="card tight stack">
        <div className="row between">
          <div><h3>My allocations</h3><div className="sub">Priority order. Click a claim to open its profile.</div></div>
          <div className="row"><span className="legend"><i style={{ background: "var(--green-soft)" }} /> closed ({counts.green})</span><span className="legend"><i style={{ background: "var(--hl)" }} /> worked, still open ({counts.yellow})</span><span className="legend"><i style={{ background: "var(--card)" }} /> not worked yet ({counts.white})</span></div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <Combo sm width={140} value={f.due} onChange={(v) => set("due", v)} placeholder="Due: any day" options={[{ id: "", label: "Due: any day" }, { id: "today", label: "Due today" }, { id: "tomorrow", label: "Due tomorrow" }, { id: "later", label: "Due later" }]} />
          <Combo sm width={170} value={f.client_id} onChange={(v) => { set("client_id", v); set("location_id", ""); }} placeholder="All clients" options={[{ id: "", label: "All clients" }, ...myClients.map((c) => ({ id: c.id, label: c.name }))]} />
          {myLocs.length > 0 && <Combo sm width={150} value={f.location_id} onChange={(v) => set("location_id", v)} placeholder="All locations" options={[{ id: "", label: "All locations" }, ...myLocs.map((l) => ({ id: l.id, label: l.name }))]} />}
          <SuggestCombo sm width={210} field="q" placeholder="claim #, patient, account" value={f.q} onChange={(v) => set("q", v)} extra={{ client_id: f.client_id || undefined }} />
          <SuggestCombo sm width={150} field="payer" placeholder="Any payer" value={f.payer} onChange={(v) => set("payer", v)} extra={{ client_id: f.client_id || undefined }} />
          <SuggestCombo sm width={150} field="provider" placeholder="Any provider" value={f.provider} onChange={(v) => set("provider", v)} extra={{ client_id: f.client_id || undefined }} />
          <SuggestCombo sm width={120} field="cpt" placeholder="Any CPT" value={f.cpt} onChange={(v) => set("cpt", v)} extra={{ client_id: f.client_id || undefined }} />
          <input className="input sm" style={{ width: 90 }} type="number" placeholder="min $" value={f.min_balance} onChange={(e) => set("min_balance", e.target.value)} />
          <input className="input sm" style={{ width: 90 }} type="number" placeholder="max $" value={f.max_balance} onChange={(e) => set("max_balance", e.target.value)} />
          <Combo sm width={180} value={f.saag_status} onChange={(v) => set("saag_status", v)} placeholder="Any SAAG status" options={[{ id: "", label: "Any SAAG status" }, ...(saagOptions.length ? saagOptions : SAAG.statuses).map((x) => ({ id: x, label: x }))]} />
          <Combo sm width={140} value={f.saag_bucket} onChange={(v) => set("saag_bucket", v)} placeholder="Any bucket" options={[{ id: "", label: "Any bucket" }, ...BUCKETS4.map((b) => ({ id: b, label: b }))]} />
          <Combo sm width={150} value={f.state} onChange={(v) => set("state", v)} placeholder="Any state" options={[{ id: "", label: "Any state" }, { id: "assigned", label: "Not worked" }, { id: "in_progress", label: "Open now" }, { id: "completed", label: "Worked today" }, { id: "closed", label: "Closed today" }]} />
          {Object.values(f).some((v) => v !== "") && <button className="btn sm link" onClick={() => setF(EMPTY_F)}>clear</button>}
          <span style={{ flex: 1 }} /><span className="small muted">{fmtInt(rows.length)} claims · {fmtMoney(sum(rows, (r) => r.balance))}</span>
        </div>
        <ErrorBox error={list.error} />
        <div className="table-wrap"><table className="t"><thead><tr>{qSort.Th("due", "Due")}{qSort.Th("claim_no", "Claim #")}{qSort.Th("patient", "Patient")}{qSort.Th("payer", "Payer")}{qSort.Th("provider", "Provider")}{qSort.Th("cpt", "CPT")}{qSort.Th("dos", "DOS")}{qSort.Th("age_days", "Age", "r")}{qSort.Th("balance", "Balance", "r")}{qSort.Th("tier", "Tier")}{qSort.Th("file_status", "File status")}{qSort.Th("saag", "SAAG")}{qSort.Th("bucket", "Bucket")}{qSort.Th("follow_up_on", "Follow-up")}{qSort.Th("state", "State")}</tr></thead>
          <tbody>{shownRows.map((r) => (
            <tr key={r.id} className={"click " + workTone(r)} onClick={() => open(r.id)}>
              <td title={"Priority " + r.priority + (r.priority_reason ? " · " + r.priority_reason : "")}>{dueOf[r.id] ? <span className={"badge " + (dueOf[r.id].days === 0 ? "red" : dueOf[r.id].days === 1 ? "amber" : dueOf[r.id].days < 0 ? "green" : "")}>{dueOf[r.id].label}</span> : ""}</td><td className="mono small">{r.claim_no || "–"}</td><td><button className="btn link sm" style={{ padding: 0, fontWeight: 600 }} title="All claims of this patient" onClick={(e) => { e.stopPropagation(); setPatientOf(r.id); }}>{r.patient}</button><div className="tiny muted">{r.client_name}{r.location_name ? " · " + r.location_name : ""}</div></td><td className="small">{r.payer}</td><td className="small">{r.provider}</td><td className="mono small">{r.cpt}</td><td className="small">{fmtDate(r.dos)}</td><td className="num">{r.age_days ?? "–"}</td><td className="num">{fmtMoney(r.balance)}</td>
              <td><TierBadge tier={r.tier} /></td><td className="small">{r.file_status}{r.file_sub_status ? <div className="tiny muted">{r.file_sub_status}</div> : null}</td>
              <td className="small"><SaagCell r={r} /></td>
              <td>{r.last_bucket ? <span className={"badge " + (r.last_bucket === "Closed" ? "green" : "teal")}>{r.last_bucket}</span> : ""}</td><td className="small">{r.follow_up_on ? fmtDate(r.follow_up_on) : ""}</td>
              <td><StateBadge state={r.state} />{r.skips ? <span className="badge amber" style={{ marginLeft: 4 }}>skipped</span> : null}{r.escalated ? <span className="badge red" style={{ marginLeft: 4 }}>esc</span> : null}<HandoffBadge status={r.handoff_status} /></td>
            </tr>))}
            {list.data && !rows.length && <tr><td colSpan={15}><Empty>Nothing on your desk for this filter.</Empty></td></tr>}</tbody></table></div>
      </div>
    </div>
  );
}
function WorkPanel({ bundle, ctx, me, onDone, onPatient }) {
  const c = bundle.claim;
  // Files attached since the last work entry count towards this entry.
  const lastWorkAt = Math.max(0, ...bundle.notes.filter((n) => n.kind === "work").map((n) => n.created_at));
  const [sibs, setSibs] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [skipAsk, setSkipAsk] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [sub, setSub] = useState("");
  const [ver, setVer] = useState(0);
  const save = async (data, key) => {
    const r = await rpc("queue.complete", { id: c.id, ...data, sibling_ids: [...sibs] });
    toast((r.closed ? "Claim closed." : `Saved. Follow-up on ${fmtDate(r.follow_up_on)}.`) + (r.completed > 1 ? ` Applied to ${r.completed} claims.` : "") + handoffToast(r.handoff));
    setVer((v) => v + 1);
    onDone(key === "next");
  };
  const skip = async (count) => {
    setBusy(true);
    try { await rpc("queue.skip", { id: c.id, reason: skipReason, count }); toast(count ? "Skipped: it comes back after the rest of your list." : "Returned to your list."); onDone(false); }
    catch (e) { toast(e.message, "err"); }
    setBusy(false);
  };
  return (
    <div className="stack" style={{ gap: 14, paddingRight: 36 }}>
      <ClaimHeader c={c}><button className="btn sm" onClick={() => skip(false)} disabled={busy} title="Put this claim back on your list and return to your day">← Back to my day</button>{onPatient && <button className="btn sm" onClick={onPatient} title="Every claim of this patient on one screen">All claims of this patient</button>}<span className="tiny muted">opened {fmtWhen(c.started_at)}</span></ClaimHeader>
      <ClaimInfo c={c} siblings={bundle.siblings} />
      <HandoffCard handoffs={bundle.handoffs} role={bundle.handoff_role} compact />
      <Suggestions claim={c} subStatus={sub || c.last_sub_status} />
      <Siblings rows={bundle.siblings} users={ctx.users} selectable selected={sibs} onToggle={(id) => setSibs((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} meId={me.id} />
      <div className="card stack" style={{ paddingBottom: 0 }}>
        <h2 style={{ margin: 0 }}>Work this claim</h2>
        {sibs.size > 0 && <div className="alert info">The same entry will also be saved on {sibs.size} other claim{sibs.size > 1 ? "s" : ""} of this patient.</div>}
        <WorkForm claim={c} newFiles={(bundle.attachments || []).filter((a) => a.created_at > lastWorkAt).length} attachments={<Attachments plain claimId={c.id} files={bundle.attachments} onChanged={() => { setVer((v) => v + 1); onDone(null); }} />}
          extraActions={<button className="btn sm" onClick={() => setSkipAsk(true)} disabled={busy}>Skip for now</button>}
          onChange={(s) => setSub(s.saag.sub_status)} buttons={[{ key: "stay", label: "Save" }, { key: "next", label: "Save & next claim", primary: true }]} onSave={save} />
      </div>
      <ClaimHistory claimId={c.id} claim={c} me={me} version={ver} />
      {skipAsk && (
        <Modal title="Skip this claim" sub="It goes to the back of your list and your team lead can see it was skipped." onClose={() => setSkipAsk(false)} narrow footer={<><button className="btn" onClick={() => setSkipAsk(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => skip(true)}>Skip</button></>}>
          <Field label="Why? (optional)"><input className="input" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} placeholder="e.g. payer portal down, need client input" autoFocus /></Field>
        </Modal>
      )}
    </div>
  );
}
/* Where a claim the biller sent stands with Payment posting / Submission. */
function HandoffCell({ h }) {
  if (!h) return null;
  const [tone, word] = { complete: ["green", h.dept === "posting" ? "Posted" : "Submitted"], back: ["amber", "Back to you"], client: ["amber", "Waiting on client"], pending: ["teal", "With " + h.label], assigned: ["teal", "With " + h.label] }[h.status] || ["gray", h.status];
  return <div><span className={"badge " + tone}>{word}</span><div className="tiny muted">{h.status === "complete" || h.status === "back" ? (h.by ? h.by + " · " : "") + fmtWhen(h.at) : h.to ? h.to : ""}{h.status === "back" && h.reason ? " · " + h.reason : ""}</div></div>;
}
function HistoryView({ ctx, me }) {
  const [pr, setPr] = useState(() => newRange("week"));
  const range = (([from, to]) => ({ from, to }))(rangeSpan(pr));
  const q = useRpc("history.mine", { from_ms: dayBounds(range.from)[0], to_ms: dayBounds(range.to)[1] }, [range.from, range.to]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") q.reload(); }, 30000); return () => clearInterval(t); }, [range.from, range.to]);
  const [open, setOpen] = useState(null);
  const rows = q.data ? q.data.rows : [];
  const hSort = useTableSort("created_at", "desc");
  const shownRows = hSort.sortRows(rows);
  return (
    <div className="stack">
      <div className="row between"><div><h1>My work</h1><div className="sub">Everything you wrote on a claim. Open one to add a note.</div></div>
        <DateRange value={pr} onChange={setPr} label="" /></div>
      <ErrorBox error={q.error} />
      {q.data && <div className="grid g3"><Kpi label="Claims worked" value={fmtInt(new Set(rows.filter((r) => r.kind === "work").map((r) => r.claim_id)).size)} tone="accent" /><Kpi label="Balance touched" value={fmtMoney(sum(rows.filter((r) => r.kind === "work"), (r) => r.balance))} /><Kpi label="Resolved" value={fmtInt(rows.filter((r) => r.kind === "work" && r.state === "closed").length)} tone="good" /></div>}
      <div className="card tight">
        {q.loading && !q.data && <Spinner />}
        <div className="table-wrap"><table className="t"><thead><tr>{hSort.Th("created_at", "When")}{hSort.Th("claim_no", "Claim #")}{hSort.Th("patient", "Patient")}{hSort.Th("client_name", "Client")}{hSort.Th("payer", "Payer")}{hSort.Th("balance", "Balance", "r")}{hSort.Th("status_code", "Status")}{hSort.Th("action_code", "Action")}{hSort.Th("follow_up_on", "Follow-up")}<th>Posting / submission</th><th>Comment</th></tr></thead>
          <tbody>{shownRows.map((r) => <tr key={r.note_id} className="click" onClick={() => setOpen(r.claim_id)}><td className="small">{fmtWhen(r.created_at)}</td><td className="mono small">{r.claim_no || "–"}</td><td>{r.patient}</td><td className="small">{r.client_name}{r.location_name ? " · " + r.location_name : ""}</td><td className="small">{r.payer}</td><td className="num">{fmtMoney(r.balance)}</td><td className="small">{r.status_code ? <><b>{r.status_code}</b>{r.sub_status ? <div className="tiny muted">{r.sub_status}</div> : null}</> : <span className="tiny muted">{r.kind}</span>}</td><td className="small">{r.action_code || ""}{r.bucket ? <div><span className={"badge " + (r.bucket === "Closed" ? "green" : "teal")}>{r.bucket}</span></div> : null}</td><td className="small">{r.follow_up_on ? fmtDate(r.follow_up_on) : ""}</td><td className="small"><HandoffCell h={r.handoff} /></td><td className="small" style={{ maxWidth: 380 }}>{r.comment}</td></tr>)}
            {q.data && !rows.length && <tr><td colSpan={11}><Empty>Nothing in this range yet.</Empty></td></tr>}</tbody></table></div>
      </div>
      {open && <ClaimDrawer id={open} ctx={ctx} me={me} onClose={() => setOpen(null)} onChanged={() => q.reload()} />}
    </div>
  );
}

/* ---------- app ---------- */
function App() {
  const [me, setMe] = useState(undefined);
  const [nav, setNav] = useState(() => hashNav() || { view: null, params: null });
  const [ctx, setCtx] = useState({ clients: [], codes: [], users: [], loaded: false });
  const [pwOpen, setPwOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const go = useCallback((view, params) => { setNav({ view, params: params || null }); try { history.replaceState(null, "", "#/" + view); } catch (e) {} window.scrollTo(0, 0); }, []);
  useEffect(() => {
    (async () => { if (!TOKEN) { setMe(null); return; } try { const r = await rpc("auth.me"); setMe(r.user); } catch (e) { setMe(null); } })();
    const h = () => setMe(null);
    const hh = () => { const h = hashNav(); if (h) setNav((n) => (n.view === h.view && JSON.stringify(n.params) === JSON.stringify(h.params) ? n : h)); };
    window.addEventListener("brahmastra:signedout", h);
    window.addEventListener("hashchange", hh);
    return () => { window.removeEventListener("brahmastra:signedout", h); window.removeEventListener("hashchange", hh); };
  }, []);
  const reload = useCallback(async () => {
    if (!me || me.must_change) return;
    try {
      const sup = me.role === "supervisor";
      const [cl, us, st] = await Promise.all([rpc("clients.list"), sup ? rpc("users.list") : Promise.resolve({ users: [] }), sup ? rpc("settings.get").catch(() => ({ settings: {} })) : Promise.resolve({ settings: {} })]);
      setCtx({ clients: cl.clients, codes: [], users: us.users, settings: st.settings || {}, loaded: true });
    } catch (e) { toast(e.message, "err"); }
  }, [me && me.id, me && me.must_change, me && me.role]);
  useEffect(() => { reload(); }, [reload]);
  // The theme saved to the account wins over this browser's, so it follows the person to any computer.
  useEffect(() => { if (me && me.prefs && Object.keys(me.prefs).length) storePrefs({ ...readPrefs(), ...me.prefs }); }, [me && me.id, me && JSON.stringify(me.prefs || {})]);
  /* After sign-in, a team lead first matches any roster project that is not yet a client, then (TLs and SMEs) sets who works each project today. */
  const [mapAsk, setMapAsk] = useState(null);
  const checkPending = useCallback(async () => {
    if (!me || me.role !== "supervisor") return;
    try {
      const um = await rpc("projects.unmapped");
      if (um.names.length) { setMapAsk(um); return; }

    } catch (e) {}
  }, [me && me.id, me && me.role]);
  useEffect(() => { if (ctx.loaded) checkPending(); }, [ctx.loaded, checkPending]);
  /* Escalations waiting for a team lead: counted every few minutes for the tab badge and the red 24-hour reminder. */
  const [attention, setAttention] = useState(null);
  const refreshAttention = useCallback(async () => { if (!me || me.role !== "supervisor") return; try { setAttention(await rpc("attention.count")); } catch (e) {} }, [me && me.id, me && me.role]);
  useEffect(() => { if (!ctx.loaded) return; refreshAttention(); const t = setInterval(refreshAttention, 5 * 60 * 1000); return () => clearInterval(t); }, [ctx.loaded, refreshAttention]);
  const [fb, setFb] = useState(null);
  const refreshFb = useCallback(async () => { if (!me) return; try { setFb(await rpc("feedback.count")); } catch (e) {} }, [me && me.id]);
  useEffect(() => { if (!ctx.loaded) return; refreshFb(); const t = setInterval(refreshFb, 5 * 60 * 1000); return () => clearInterval(t); }, [ctx.loaded, refreshFb]);
  const [handoffs, setHandoffs] = useState(null);
  const refreshHandoffs = useCallback(async () => { if (!me) return; try { setHandoffs(await rpc("handoffs.count")); } catch (e) {} }, [me && me.id]);
  useEffect(() => { if (!ctx.loaded) return; refreshHandoffs(); const t = setInterval(refreshHandoffs, 30000); return () => clearInterval(t); }, [ctx.loaded, refreshHandoffs]);
  const [notify, setNotify] = useState(null);
  const refreshNotify = useCallback(async () => { if (!me) return; try { setNotify(await rpc("notify.list", { today: todayISO() })); } catch (e) {} }, [me && me.id]);
  useEffect(() => { if (!ctx.loaded) return undefined; refreshNotify(); const t = setInterval(refreshNotify, 30000); return () => clearInterval(t); }, [ctx.loaded, refreshNotify, nav.view]);
  // Back on the tab: refresh the desk count and the bell at once, so a hand-off or its result shows without waiting.
  useEffect(() => { if (!ctx.loaded) return undefined; const f = () => { if (document.visibilityState === "visible") { refreshHandoffs(); refreshNotify(); } };
    document.addEventListener("visibilitychange", f); window.addEventListener("focus", f); return () => { document.removeEventListener("visibilitychange", f); window.removeEventListener("focus", f); }; }, [ctx.loaded, refreshHandoffs, refreshNotify]);
  const [pal, setPal] = useState(false);
  const [palClaim, setPalClaim] = useState(null);
  const [palCoach, setPalCoach] = useState(null);
  useEffect(() => {
    if (!me || !ctx.loaded) return undefined;
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key).toLowerCase() === "k") { e.preventDefault(); setPal((p) => !p); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [me && me.id, ctx.loaded]);
  const signOut = async () => { try { await rpc("auth.logout"); } catch (e) {} try { localStorage.removeItem(DRISHTI_TOKEN_KEY); } catch (e) {} setToken(null); setMe(null); setCtx({ clients: [], codes: [], users: [], loaded: false }); setPal(false); setPalClaim(null); setPalCoach(null); };
  const idleLeft = useIdleSignOut(!!me, signOut);
  if (me === undefined) return <div className="login"><Spinner label="Starting…" /></div>;
  if (!me) return <><LoginScreen onSignedIn={(u) => { setMe(u); go(u.role === "supervisor" ? "dashboard" : "queue"); }} /><Toaster /></>;
  if (me.must_change) return (
    <div className="login"><div className="box stack"><div style={{ display: "flex", justifyContent: "center" }}><Wordmark size={28} /></div><div className="card"><h2>Set your password</h2><div className="sub mb">Signed in as {me.email}</div><ChangePasswordForm forced me={me} onDone={() => setMe({ ...me, must_change: false, has_password: true })} /><div className="mt"><button className="btn link sm" onClick={signOut}>Sign out</button></div></div></div><Toaster /></div>
  );
  const allowed = [...navItems(navFor(me, handoffs, fb, attention)).map((x) => x[0]), "settings", ...(me.role === "supervisor" ? ["digest"] : []), ...(me.role === "supervisor" && !deskOf(me, handoffs) ? Object.keys(NAV_ALIAS) : [])];
  const view = allowed.includes(nav.view) ? nav.view : (me.role === "supervisor" ? "dashboard" : deskOf(me, handoffs) ? "handoffs" : "queue");
  const props = { ctx, me, reload, go, params: nav.params, refreshAttention, refreshHandoffs, handoffs, refreshFb };
  const body = !ctx.loaded ? <Spinner label="Loading…" />
    : view === "dashboard" ? (deskOf(me, handoffs) ? <DeskDashboard {...props} desk={deskOf(me, handoffs)} /> : <DashboardHub {...props} />)
    : view === "portfolio" && me.role === "supervisor" ? <DashboardHub {...props} params={{ ...(props.params || {}), tab: "inventory" }} />
    : (view === "live" || view === "teamtoday") && me.role === "supervisor" ? <LiveStatusView {...props} />
    : view === "attention" ? <AttentionView {...props} />
    : view === "digest" ? <DigestDashboard {...props} />
    : view === "escalations" && me.role === "supervisor" ? <EscalationTrackerView {...props} />
    : view === "inventory" || view === "allocate" ? <InventoryView {...props} initialTab={view === "allocate" ? "allocate" : undefined} />
    : view === "claims" ? (me.role === "supervisor" ? <ClaimsView {...props} /> : <DeskClaimsView {...props} />)
    : view === "team" ? <TeamView {...props} />
    : (view === "clients" || view === "locations") && me.role !== "supervisor" ? <ClientsView {...props} />
    : view === "clients" || view === "locations" ? <ClientsHub {...props} initialTab={view === "locations" ? "billers" : undefined} />
    : view === "saag" ? <SaagView {...props} />
    : view === "reports" && me.role === "supervisor" ? <ClaimsView {...props} initialTab="entries" />
    : (view === "queue" || view === "mydesk") && me.role === "supervisor" ? <MyDeskView {...props} />
    : view === "history" ? <HistoryView {...props} />
    : view === "roster" ? <RosterView {...props} />
    : view === "handoffs" ? <HandoffsView {...props} />
    : view === "raci" ? <RaciView {...props} />
    : view === "client" && me.role === "supervisor" ? <ClientView {...props} />
    : view === "audit" && (me.is_admin || me.access_all) ? <AuditView {...props} />
    : view === "feedback" ? <FeedbackInbox {...props} />
    : view === "templates" && me.role === "supervisor" ? <TemplatesView {...props} />
    : view === "sla" && me.role === "supervisor" ? <SlaView {...props} />
    : view === "thirdeye" && me.role === "supervisor" ? <ThirdEyeView {...props} />
    : view === "limits" ? <LimitsView {...props} />
    : view === "settings" ? <SettingsView {...props} setMe={setMe} />
    : <QueueView {...props} />;
  return (
    <>
      <Shell me={me} view={view} attention={attention} handoffs={handoffs} fb={fb} notify={notify} onRefreshNotify={refreshNotify} onGo={go} onSearch={() => setPal(true)} setView={(v) => go(v)} onSignOut={signOut} onChangePassword={() => setPwOpen(true)} onDeleteAccount={() => setDelOpen(true)}>
        <React.Fragment key={view + JSON.stringify(nav.params || {})}>{body}</React.Fragment>
      </Shell>
      {mapAsk && <ProjectMapModal names={mapAsk.names} clients={mapAsk.clients} canCreate onClose={() => { setMapAsk(null); }} onDone={async () => { setMapAsk(null); await reload(); checkPending(); }} />}
      {pal && <CommandPalette ctx={ctx} me={me} pages={navItems(navFor(me, handoffs, fb, attention)).concat([["settings", "Settings"]])} go={go} onClose={() => setPal(false)} openClaim={setPalClaim} openCoach={setPalCoach} />}
      {palClaim && <ClaimDrawer id={palClaim} ctx={ctx} me={me} onClose={() => setPalClaim(null)} onChanged={() => {}} />}
      {palCoach && <CoachDrawer userId={palCoach} onClose={() => setPalCoach(null)} />}
      {idleLeft != null && <div className="idle-warn" role="alert"><b>Still there?</b> You will be signed out in {Math.floor(idleLeft / 60)}:{String(idleLeft % 60).padStart(2, "0")} to keep patient data safe. Move the mouse or press any key to stay signed in.</div>}
      {delOpen && <DeleteMyAccount me={me} onClose={() => setDelOpen(false)} onDeleted={() => { setDelOpen(false); signOut(); }} />}
      {pwOpen && <Modal title={me.has_password ? "Change password" : "Set a password"} onClose={() => setPwOpen(false)} narrow><ChangePasswordForm me={me} onDone={() => { setPwOpen(false); setMe({ ...me, has_password: true }); }} onCancel={() => setPwOpen(false)} /></Modal>}
      <Toaster />
    </>
  );
}
window.addEventListener("error", (e) => { const r = document.getElementById("root"); if (r && !r.childElementCount) r.innerHTML = '<div style="font:14px Inter,system-ui,sans-serif;padding:40px;color:#A32D2D;max-width:720px;margin:0 auto"><b>Brahmastra could not start.</b><br/>' + String(e.message || e.error || "Unknown error").replace(/</g, "&lt;") + '</div>'; });
if (!window.__BRAHMASTRA_MS_CALLBACK) ReactDOM.createRoot(document.getElementById("root")).render(<App />);
