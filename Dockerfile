FROM php:8.3-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libpq-dev \
       libzip-dev \
       zip \
       git \
       curl \
       openssl \
    && docker-php-ext-install pdo pdo_pgsql \
    && a2enmod rewrite headers ssl \
    && rm -rf /var/lib/apt/lists/*

# optional: composer for dependency management
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

WORKDIR /var/www/html

COPY config/apache/vhost.conf /etc/apache2/sites-available/000-default.conf

# Generate self-signed certificate
RUN openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/ssl/private/self-signed.key \
    -out /etc/ssl/certs/self-signed.crt \
    -subj "/C=DE/ST=State/L=City/O=Org/CN=localhost"

CMD ["apache2-foreground"]
