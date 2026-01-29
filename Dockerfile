FROM php:8.3-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libpq-dev \
       libzip-dev \
       zip \
       git \
       curl \
    && docker-php-ext-install pdo pdo_pgsql \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

# optional: composer for dependency management
RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

WORKDIR /var/www/html

COPY config/apache/vhost.conf /etc/apache2/sites-available/000-default.conf

CMD ["apache2-foreground"]
