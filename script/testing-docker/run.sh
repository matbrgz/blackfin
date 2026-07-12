#!/bin/bash

IMAGE_NAME="blackfin-tests"

script_dir=$(dirname $0)
repo_root=$(realpath "$script_dir/../..")

# Check if image exists
if [[ "$(docker images -q $IMAGE_NAME 2> /dev/null)" == "" ]]; then
  echo "Image not found. Building image..."
  docker build -t $IMAGE_NAME -f "$script_dir/Dockerfile" "$script_dir/."
fi

docker run --rm -v "$repo_root:/app" $IMAGE_NAME
