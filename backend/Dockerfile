FROM python:3.11-slim
RUN apt-get update && apt-get install -y gcc libpq-dev wget unzip && rm -rf /var/lib/apt/lists/*

# OWASP Amass Installation
RUN wget https://github.com/owasp-amass/amass/releases/download/v4.2.0/amass_Linux_amd64.zip -O amass.zip \
    && unzip amass.zip \
    && mv amass_Linux_amd64/amass /usr/local/bin/ \
    && rm -rf amass.zip amass_Linux_amd64

# ProjectDiscovery Nuclei Installation
RUN wget https://github.com/projectdiscovery/nuclei/releases/download/v3.2.9/nuclei_3.2.9_linux_amd64.zip -O nuclei.zip \
    && unzip nuclei.zip \
    && mv nuclei /usr/local/bin/ \
    && rm -rf nuclei.zip

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]