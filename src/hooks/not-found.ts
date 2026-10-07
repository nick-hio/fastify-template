import fp from "fastify-plugin";

export default fp((fastify, _opts, done) => {
    fastify.setNotFoundHandler(async (_req, res) => {
        return res.code(404).send('Not Found');
    });

    done();
});
