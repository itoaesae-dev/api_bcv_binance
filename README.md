# Valor local

Dashboard para consultar el dólar BCV, euro BCV y dólar Binance en Venezuela usando [DolarApi](https://dolarapi.com/docs/venezuela/) y la consulta pública de [Binance P2P](https://p2p.binance.com/).

## Ejecutar localmente

Desde esta carpeta:

```bash
python3 server.py
```

Luego abre `http://localhost:4173`.

## Regla de fechas

- Viernes consulta la fecha actual.
- Sábado y domingo consultan la fecha del lunes siguiente para dólar y euro BCV.
- Si el lunes todavía no está publicado en la API, se mantiene visible el último valor BCV disponible y se marca como respaldo.
- Binance consulta dos precios públicos P2P de `USDT/VES`: `BUY` para compra y `SELL` para venta.
- El monto principal mostrado es el promedio de ambos precios: `(compra + venta) / 2`.
- Si Binance P2P no responde, se usa DolarApi como respaldo y se indica en pantalla.

La app refresca al cargar, con el botón `Actualizar` y automáticamente cada 10 minutos.

## Publicar en Vercel

El archivo `api/binance.js` expone el proxy de Binance como función serverless; Vercel detecta automáticamente los archivos dentro de `/api`. No necesita variables de entorno ni API key.

## Favicon

`favicon.svg` contiene el ícono del dashboard y ya está enlazado desde `index.html`.
