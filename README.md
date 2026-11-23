This is the server for blakes put-em-on-skates game

start server:
$ dc up --build -d

watch logs:
$ dc logs -f

stop:
$ dc down

change map:
$ echo "$map_name" | socat EXEC:"docker attach put-em-on-skates-server",pty STDIN
this runs the command $map_name on the docker container server.
