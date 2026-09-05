# Valor local

Dashboard para consultar el dólar BCV, euro BCV y dólar Binance en Venezuela usando [DolarApi](https://dolarapi.com/docs/venezuela/) y la consulta pública de [Binance P2P](https://p2p.binance.com/).

## Ejecutar localmente

Desde esta carpeta:

```bash
python3 server.py
```

Luego abre `http://localhost:4173`.

## Regla de fechas

- Viernes consulta la fecha actual hasta las 6:00 p. m. (hora de Caracas).
- Desde las 6:00 p. m. del viernes, y durante sábado y domingo, dólar y euro BCV consultan la fecha del lunes siguiente.
- Si el lunes todavía no está publicado en la API, se mantiene visible el último valor BCV disponible y se marca como respaldo.
- Binance consulta el mercado P2P público de `USDT/VES` con `Todos los métodos de pago`, sin monto escrito y mostrando anuncios de comerciantes, igual que la vista de Binance.
- La tarjeta toma el menor anuncio de compra (`BUY`) y el mayor anuncio de venta (`SELL`) entre los 20 anuncios de comerciantes consultados.
- El monto principal mostrado es el promedio de ambos precios: `(compra + venta) / 2`.
- Si Binance P2P no responde, se usa DolarApi como respaldo y se indica en pantalla.

La app refresca al cargar, con el botón `Actualizar` y automáticamente cada 10 minutos. Cada consulta Binance lleva un identificador único y el endpoint responde sin caché, por lo que el botón solicita datos nuevos de inmediato.

## Publicar en Vercel

El archivo `api/binance.js` expone el proxy de Binance como función serverless; Vercel detecta automáticamente los archivos dentro de `/api`. No necesita variables de entorno ni API key.

## Favicon

`favicon.svg` contiene el ícono del dashboard y ya está enlazado desde `index.html`.
