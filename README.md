# Valor local

Dashboard para consultar el dólar BCV, euro BCV y dólar Binance en Venezuela usando [DolarApi](https://dolarapi.com/docs/venezuela/) y [ExchangeMonitor](https://exchangemonitor.net/venezuela/dolar-binance).

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
- Binance consulta ExchangeMonitor desde el proxy local `/api/binance`, que extrae el precio principal, compra y venta de la página compartida.
- Si ExchangeMonitor no responde, Binance usa DolarApi como respaldo y lo indica en pantalla.

La app refresca al cargar, con el botón `Actualizar` y automáticamente cada 10 minutos.

## Publicar en Vercel

El archivo `api/binance.js` expone el mismo proxy de Binance como función serverless; Vercel lo detecta automáticamente al importar este repositorio. No necesita variables de entorno.

Si ExchangeMonitor no responde desde la función de Vercel, el dashboard conserva el respaldo de DolarApi para que las cotizaciones oficiales sigan visibles.

## Favicon

`favicon.svg` contiene el ícono del dashboard y ya está enlazado desde `index.html`.
