#!/bin/bash

OUTPUT_DIR=$1
echo "Copying prompts to ${OUTPUT_DIR}/config"
mkdir -p ${OUTPUT_DIR}/config

cp src/config/prompt.txt ${OUTPUT_DIR}/config/prompt.txt
cp src/config/batch-prompt.txt ${OUTPUT_DIR}/config/batch-prompt.txt