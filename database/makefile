ImageName?=sherry/pgvector
ContainerName?=pgvector
PORT?=5432
MKFILE := $(abspath $(lastword $(MAKEFILE_LIST)))
CURDIR := $(dir $(MKFILE))

log:
	docker logs -f -t --tail 20 ${ContainerName}

rm:
	docker rm ${ContainerName}

docker:
	docker build -t ${ImageName} .

run:
	docker run -d --name ${ContainerName} \
	-p 5432:5432 \
	-v pgdata_vol:/var/lib/postgresql/data \
	--env-file ${CURDIR}envfile \
	${ImageName}
