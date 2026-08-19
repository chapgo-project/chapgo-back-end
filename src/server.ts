import { createServer } from 'node:http';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
});

server.listen(port, host, () => {
    console.log(`ChapGo backend running on port ${port}`);
});